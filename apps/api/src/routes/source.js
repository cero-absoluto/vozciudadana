import { supabase } from '../services/supabase.js';
import {
  classifyDomain, domainBaseScore, computeRelevance,
  safeFetch, extractMeta, wikidataDomainLookup, BLOCKED_DOMAINS,
} from '../lib/sourceCheck.js';

// ── Blocked IP ranges and schemes ─────────────────────────────────────────
const BLOCKED_SCHEMES = ['file:', 'ftp:', 'data:', 'javascript:'];
// Fast, cheap pre-filter only — a plain string match on the hostname as
// written. The real protection (DNS resolution, private/reserved-IP
// rejection on every redirect hop, no automatic redirect-following) lives
// in safeFetch() (lib/sourceCheck.js, VP-SEC-005 fix, 23 July 2026), which
// every caller of source validation goes through, including this route.
// This regex catches the most obvious cases slightly earlier and cheaper,
// nothing more — do not rely on it alone.
const PRIVATE_HOSTNAMES = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/ ;

// ── Validation status from score ───────────────────────────────────────────
function statusFromScore(score) {
  if (score >= 80) return 'VERIFIED_SOURCE';
  if (score >= 60) return 'RELEVANT_SOURCE';
  if (score >= 40) return 'WEAK_SOURCE';
  return 'NEEDS_REVIEW';
}

function messageForStatus(status, sourceType) {
  // Language rule: we describe documentary quality, never truth or credibility.
  // Per Audit Alignment Framework v2.1: "Voice Protest does not assess the
  // truthfulness of claims. It may provide informational indicators regarding
  // the documentary quality and apparent relevance of sources submitted by
  // event creators."
  switch (status) {
    case 'VERIFIED_SOURCE':
      return 'Your event has a strong documentary basis.';
    case 'RELEVANT_SOURCE':
      return 'Your event has a reasonable documentary basis.';
    case 'WEAK_SOURCE':
      return 'Your supporting source may not be clearly related to the reported issue. Consider providing a more specific source.';
    case 'UNAVAILABLE_SOURCE':
      return 'The source could not be accessed. It may be behind a paywall or temporarily unavailable. Participants will not be able to verify it directly.';
    case 'PAYWALLED_SOURCE':
      return 'The source appears to be behind a paywall. It has been recorded but participants may not be able to access it directly.';
    case 'UNRELATED_SOURCE':
      return 'The relationship between the submitted source and the reported issue is unclear. Participants may find it difficult to understand the documentary basis of the event.';
    case 'BLOCKED_SOURCE':
      return 'This type of source is not accepted. Please provide a news article, official document or dataset.';
    default:
      return 'The source requires manual review before the event can be published.';
  }
}

// ── Event-level documentary score ─────────────────────────────────────────
// Combines source quality, institutional verification, action verb presence,
// and documentary relevance into a single informational indicator shown to
// the event creator. This score describes documentary quality only — it does
// not assess truth, legitimacy or representativeness.
// It is never used to block publication (only hard admission rules block).
function computeEventScore({ sourceScore, sourceStatus, hasActionVerb, hasBlockedVerb, wikidataVerified, relevanceScore }) {
  let score = 0;

  // Source quality (max 35)
  if (sourceStatus === 'VERIFIED_SOURCE')  score += 35;
  else if (sourceStatus === 'RELEVANT_SOURCE')  score += 25;
  else if (sourceStatus === 'WEAK_SOURCE')       score += 10;
  else if (sourceStatus === 'PAYWALLED_SOURCE')  score += 8;

  // Institution verified as public in Wikidata (max 20)
  if (wikidataVerified) score += 20;

  // Action verb present in demands (max 20)
  if (hasActionVerb && !hasBlockedVerb) score += 20;
  else if (hasActionVerb && hasBlockedVerb) score += 10; // mixed — partial

  // Documentary relevance: article text ↔ title+demands (max 30, already computed)
  score += Math.min(relevanceScore || 0, 30);

  return Math.min(100, Math.max(0, score));
}

function eventScoreMessage(score) {
  if (score >= 70) return 'Your event has a strong documentary basis.';
  if (score >= 40) return 'Your supporting source may not be clearly related to the reported issue. Consider providing a more specific source.';
  return 'The relationship between the submitted source and the reported issue is unclear. Participants may find it difficult to understand the documentary basis of the event.';
}

// ── Main route handler ─────────────────────────────────────────────────────
/** @param {import('fastify').FastifyInstance} app */
export default async function sourceRoutes(app) {

  app.post('/validate', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['source_url'],
        properties: {
          source_url:       { type: 'string', minLength: 10, maxLength: 2000 },
          title:            { type: 'string', maxLength: 255, default: '' },
          demands:          { type: 'string', maxLength: 2000, default: '' },
          tipo_abuso:       { type: 'string', maxLength: 120, default: '' },
          target_name:      { type: 'string', maxLength: 255, default: '' },
          has_action_verb:  { type: 'boolean', default: false },
          has_blocked_verb: { type: 'boolean', default: false },
          wikidata_verified:{ type: 'boolean', default: false },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { source_url, title = '', demands = '', tipo_abuso = '', target_name = '' } = req.body;

    // ── 1. Parse and validate URL ────────────────────────────────────────
    let parsed;
    try {
      const normalized = source_url.startsWith('http') ? source_url : `https://${source_url}`;
      parsed = new URL(normalized);
    } catch {
      return reply.badRequest('Invalid URL format.');
    }

    if (BLOCKED_SCHEMES.includes(parsed.protocol)) {
      return reply.status(422).send({
        source_validation_status: 'BLOCKED_SOURCE',
        message: 'This URL scheme is not allowed.',
      });
    }

    const hostname = parsed.hostname;
    if (PRIVATE_HOSTNAMES.test(hostname)) {
      return reply.status(422).send({
        source_validation_status: 'BLOCKED_SOURCE',
        message: 'Private or local URLs are not allowed.',
      });
    }

    const domain = hostname.replace(/^www\./, '');

    // ── 2. Check blocked domains ─────────────────────────────────────────
    if (BLOCKED_DOMAINS.has(domain)) {
      return reply.status(422).send({
        source_validation_status: 'BLOCKED_SOURCE',
        source_domain: domain,
        source_type: 'blocked',
        message: messageForStatus('BLOCKED_SOURCE', 'blocked'),
      });
    }

    // ── 3. Classify domain ───────────────────────────────────────────────
    const wikidataType = await wikidataDomainLookup(domain);
    const sourceType   = classifyDomain(domain, wikidataType);
    let   domainScore  = domainBaseScore(sourceType);

    // ── 4. Fetch URL content ─────────────────────────────────────────────
    const fetchResult = await safeFetch(parsed.href);
    let meta = {};
    let accessScore = 0;
    let metaScore   = 0;
    let dateScore   = 0;
    let canonicalScore = 0;
    let validationStatus;
    let sourceError = null;

    if (!fetchResult.ok) {
      // safeFetch() now only returns ok:false for genuine failures — network
      // error, timeout, 404, 5xx or a non-HTML response. Paywall-like status
      // codes (401/403/429) still come through as ok:true with a
      // `paywallLike` flag, since we can usually still read og: metadata
      // from them.
      validationStatus = 'UNAVAILABLE_SOURCE';
      sourceError = fetchResult.reason || `HTTP ${fetchResult.status}`;
    } else {
      accessScore    = 15;
      meta           = extractMeta(fetchResult.html, fetchResult.finalUrl);
      metaScore      = (meta.title ? 5 : 0) + (meta.description ? 5 : 0);
      dateScore      = meta.publishedAt ? 10 : 0;
      canonicalScore = meta.canonical ? 5 : 0;

      // ── 5. Relevance score ─────────────────────────────────────────────
      const searchText = [meta.title, meta.description, meta.bodyText].filter(Boolean).join(' ');
      const relevanceScore = computeRelevance(searchText, { title, demands, tipo_abuso, target_name });

      const confidenceScore = Math.min(100,
        domainScore + accessScore + metaScore + dateScore + canonicalScore + relevanceScore
      );

      validationStatus = fetchResult.paywallLike ? 'PAYWALLED_SOURCE' : statusFromScore(confidenceScore);

      // ── 6. Save to Supabase ───────────────────────────────────────────
      const record = {
        source_url:               parsed.href,
        canonical_url:            meta.canonical || parsed.href,
        source_domain:            domain,
        source_type:              sourceType,
        source_title:             meta.title,
        source_description:       meta.description,
        source_author:            meta.author,
        published_at:             meta.publishedAt || null,
        language:                 meta.language,
        preview_image:            meta.image,
        source_confidence_score:  confidenceScore,
        source_relevance_score:   relevanceScore,
        source_validation_status: validationStatus,
        source_validation_source: wikidataType ? 'WIKIDATA' : 'INTERNAL',
        source_checked_at:        new Date().toISOString(),
        source_error:             null,
      };

      await supabase.from('source_validations').insert(record).select().single();

      return reply.send({
        source_url:               parsed.href,
        canonical_url:            meta.canonical || parsed.href,
        source_domain:            domain,
        source_type:              sourceType,
        source_title:             meta.title,
        source_description:       meta.description,
        source_author:            meta.author,
        published_at:             meta.publishedAt,
        language:                 meta.language,
        preview_image:            meta.image,
        source_confidence_score:  confidenceScore,
        source_relevance_score:   relevanceScore,
        source_validation_status: validationStatus,
        message:                  messageForStatus(validationStatus, sourceType),
        event_score:              computeEventScore({
          sourceScore:      confidenceScore,
          sourceStatus:     validationStatus,
          hasActionVerb:    req.body.has_action_verb ?? false,
          hasBlockedVerb:   req.body.has_blocked_verb ?? false,
          wikidataVerified: req.body.wikidata_verified ?? false,
          relevanceScore,
        }),
        event_score_message: eventScoreMessage(computeEventScore({
          sourceScore:      confidenceScore,
          sourceStatus:     validationStatus,
          hasActionVerb:    req.body.has_action_verb ?? false,
          hasBlockedVerb:   req.body.has_blocked_verb ?? false,
          wikidataVerified: req.body.wikidata_verified ?? false,
          relevanceScore,
        })),
      });
    }

    // Unavailable / paywalled — save minimal record
    await supabase.from('source_validations').insert({
      source_url:               parsed.href,
      source_domain:            domain,
      source_type:              sourceType,
      source_confidence_score:  domainScore,
      source_relevance_score:   0,
      source_validation_status: validationStatus,
      source_validation_source: 'INTERNAL',
      source_checked_at:        new Date().toISOString(),
      source_error:             sourceError,
    });

    return reply.send({
      source_url:               parsed.href,
      source_domain:            domain,
      source_type:              sourceType,
      source_confidence_score:  domainScore,
      source_relevance_score:   0,
      source_validation_status: validationStatus,
      message:                  messageForStatus(validationStatus, sourceType),
      event_score:              computeEventScore({
        sourceScore:      domainScore,
        sourceStatus:     validationStatus,
        hasActionVerb:    req.body.has_action_verb ?? false,
        hasBlockedVerb:   req.body.has_blocked_verb ?? false,
        wikidataVerified: req.body.wikidata_verified ?? false,
        relevanceScore:   0,
      }),
      event_score_message: eventScoreMessage(computeEventScore({
        sourceScore:      domainScore,
        sourceStatus:     validationStatus,
        hasActionVerb:    req.body.has_action_verb ?? false,
        hasBlockedVerb:   req.body.has_blocked_verb ?? false,
        wikidataVerified: req.body.wikidata_verified ?? false,
        relevanceScore:   0,
      })),
    });
  });
}
