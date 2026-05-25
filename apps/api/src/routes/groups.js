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
  // GET /api/grupos/:id/estado
  // Devuelve el estado del grupo
  app.get('/:id/estado', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          email_hash: { type: 'string', minLength: 64, maxLength: 64 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { id: group_id } = req.params;
    const { email_hash } = req.query;

    // Obtener el grupo
    const { data: group, error: groupErr } = await supabase
      .from('groups')
      .select('*')
      .eq('id', group_id)
      .single();

    if (groupErr || !group) return reply.notFound('Grupo no encontrado');

    // Contar miembros acreditados
    const { count: acreditados } = await supabase
      .from('group_members')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', group_id)
      .not('accredited_at', 'is', null);

    // Solicitudes pendientes
    const { data: solicitudes } = await supabase
      .from('vouch_requests')
      .select('id, candidate_hash, requested_at')
      .eq('group_id', group_id)
      .eq('status', 'pending');

    // Enriquecer solicitudes con vouches recibidos
    const solicitudesConVouches = await Promise.all(
      (solicitudes || []).map(async s => {
        const { count } = await supabase
          .from('vouches')
          .select('id', { count: 'exact', head: true })
          .eq('group_id', group_id)
          .eq('candidate_hash', s.candidate_hash);

        const ya_avalado = email_hash ? await supabase
          .from('vouches')
          .select('id')
          .eq('group_id', group_id)
          .eq('voucher_hash', email_hash)
          .eq('candidate_hash', s.candidate_hash)
          .maybeSingle().then(r => !!r.data) : false;

        return { ...s, vouches_recibidos: count || 0, ya_avalado };
      })
    );

    // Mi estado como miembro
    let miEstado = { acreditado: false, es_genesis: false, vouches_dados: 0 };
    if (email_hash) {
      const { data: miembro } = await supabase
        .from('group_members')
        .select('is_genesis, vouches_given, accredited_at')
        .eq('group_id', group_id)
        .eq('email_hash', email_hash)
        .maybeSingle();

      if (miembro) {
        miEstado = {
          acreditado:    !!miembro.accredited_at,
          es_genesis:    miembro.is_genesis,
          vouches_dados: miembro.vouches_given || 0,
        };
      }
    }

    return {
      group,
      acreditados:             acreditados || 0,
      pendientes:              solicitudesConVouches.length,
      objetivo:                30,
      mis_vouches_restantes:   Math.max(0, group.max_vouches_per_member - miEstado.vouches_dados),
      solicitudes:             solicitudesConVouches,
      mi_estado:               miEstado,
    };
  });
  // POST /api/grupos/:id/invite
  // Genera un link de invitación personal
  app.post('/:id/invite', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['inviter_hash'],
        properties: {
          inviter_hash: { type: 'string', minLength: 64, maxLength: 64 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { id: group_id } = req.params;
    const { inviter_hash } = req.body;

    // Verificar que el invitador es miembro acreditado
    const { data: miembro } = await supabase
      .from('group_members')
      .select('id, accredited_at')
      .eq('group_id', group_id)
      .eq('email_hash', inviter_hash)
      .maybeSingle();

    if (!miembro?.accredited_at) return reply.forbidden('Solo los miembros acreditados pueden invitar');

    // Crear link de invitación
    const { data: invite, error } = await supabase
      .from('invite_links')
      .insert({ group_id, inviter_hash })
      .select()
      .single();

    if (error) throw error;

    const baseUrl = process.env.FRONTEND_URL || 'https://cero-absoluto.github.io/vozciudadana';
    return { token: invite.token, url: `${baseUrl}/#/invite/${invite.token}` };
  });
  // GET /api/grupos/invite/:token
  // Valida un token de invitación y devuelve los datos del grupo
  app.get('/invite/:token', {
    schema: {
      params: {
        type: 'object',
        properties: { token: { type: 'string' } },
        required: ['token'],
      },
    },
  }, async (req, reply) => {
    const { token } = req.params;

    const { data: invite, error } = await supabase
      .from('invite_links')
      .select('id, group_id, uses_count, max_uses, groups(id, name, protest_id, protests(convocatoria_institucion, convocatoria_region))')
      .eq('token', token)
      .single();

    if (error || !invite) return reply.notFound('Invitación no encontrada');
    if (invite.uses_count >= invite.max_uses) return reply.badRequest('Este link ha alcanzado el máximo de usos');

    return {
      valid:       true,
      group_id:    invite.group_id,
      protest_id:  invite.groups.protest_id,
      institucion: invite.groups.protests?.convocatoria_institucion || 'Institución',
      region:      invite.groups.protests?.convocatoria_region || '',
    };
  });
  // GET /api/grupos/por-convocatoria/:protestId
  // Busca el grupo asociado a una convocatoria
  app.get('/por-convocatoria/:protestId', {
    schema: {
      params: {
        type: 'object',
        properties: { protestId: { type: 'string', format: 'uuid' } },
        required: ['protestId'],
      },
    },
  }, async (req, reply) => {
    const { protestId } = req.params;

    const { data: group, error } = await supabase
      .from('groups')
      .select('id, name, protest_id')
      .eq('protest_id', protestId)
      .maybeSingle();

    if (error) throw error;
    if (!group) return reply.notFound('No hay grupo para esta convocatoria');

    return { group_id: group.id, name: group.name };
  });
}
