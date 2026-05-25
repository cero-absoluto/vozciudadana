import { supabase } from '../services/supabase.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function gruposRoutes(app) {

  // POST /api/grupos/crear
  // Crea un grupo y designa al nodo génesis
  app.post('/crear', {
    schema: {
      body: {
        type: 'object',
        required: ['protest_id', 'genesis_hash', 'name'],
        properties: {
          protest_id:   { type: 'string', format: 'uuid' },
          genesis_hash: { type: 'string', minLength: 64, maxLength: 64 },
          name:         { type: 'string', minLength: 1, maxLength: 120 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { protest_id, genesis_hash, name } = req.body;

    // Crear el grupo
    const { data: group, error: groupErr } = await supabase
      .from('groups')
      .insert({ protest_id, genesis_hash, name })
      .select()
      .single();

    if (groupErr) throw groupErr;

    // Insertar al nodo génesis como miembro acreditado
    const { error: memberErr } = await supabase
      .from('group_members')
      .insert({
        group_id:      group.id,
        email_hash:    genesis_hash,
        is_genesis:    true,
        accredited_at: new Date().toISOString(),
      });

    if (memberErr) throw memberErr;

    return reply.code(201).send({ group_id: group.id });
  });
  // POST /api/grupos/:id/solicitar
  // Un nuevo miembro solicita unirse al grupo tras verificar su email
  app.post('/:id/solicitar', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['email_hash'],
        properties: {
          email_hash: { type: 'string', minLength: 64, maxLength: 64 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { id: group_id } = req.params;
    const { email_hash } = req.body;

    // Verificar que el grupo existe
    const { data: group, error: groupErr } = await supabase
      .from('groups')
      .select('id, vouch_threshold')
      .eq('id', group_id)
      .single();

    if (groupErr || !group) return reply.notFound('Grupo no encontrado');

    // Comprobar si ya es miembro
    const { data: existing } = await supabase
      .from('group_members')
      .select('id, accredited_at')
      .eq('group_id', group_id)
      .eq('email_hash', email_hash)
      .maybeSingle();

    if (existing?.accredited_at) return reply.conflict('Ya eres miembro acreditado de este grupo');

    // Insertar en group_members si no existe
    if (!existing) {
      await supabase.from('group_members').insert({
        group_id,
        email_hash,
        is_genesis: false,
      });
    }

    // Crear solicitud de vouch si no existe
    const { data: existingReq } = await supabase
      .from('vouch_requests')
      .select('id')
      .eq('group_id', group_id)
      .eq('candidate_hash', email_hash)
      .eq('status', 'pending')
      .maybeSingle();

    if (!existingReq) {
      await supabase.from('vouch_requests').insert({
        group_id,
        candidate_hash: email_hash,
        status: 'pending',
      });
    }

    return reply.code(201).send({ requested: true });
  });
// POST /api/grupos/:id/vouch
  // Un miembro acreditado avala a un candidato
  app.post('/:id/vouch', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['voucher_hash', 'candidate_hash'],
        properties: {
          voucher_hash:   { type: 'string', minLength: 64, maxLength: 64 },
          candidate_hash: { type: 'string', minLength: 64, maxLength: 64 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { id: group_id } = req.params;
    const { voucher_hash, candidate_hash } = req.body;

    // Llamar a la función process_vouch de Supabase
    const { data, error } = await supabase.rpc('process_vouch', {
      p_group_id:      group_id,
      p_voucher_hash:  voucher_hash,
      p_candidate_hash: candidate_hash,
    });

    if (error) throw error;

    // Si el candidato fue acreditado, actualizar vouch_requests
    if (data?.accredited) {
      await supabase
        .from('vouch_requests')
        .update({ status: 'accredited' })
        .eq('group_id', group_id)
        .eq('candidate_hash', candidate_hash);
    }

    return data;
  });
}
