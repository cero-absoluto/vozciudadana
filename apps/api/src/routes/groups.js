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

}
