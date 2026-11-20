import { database } from '../db';
import { RubricError, type Rubric, type RubricDefinition } from './definition';

export async function listRubrics(includeHistory: boolean) {
  const source = includeHistory ? 'garden.rubric_templates' : `(
    SELECT DISTINCT ON (id) * FROM garden.rubric_templates ORDER BY id, revision DESC
  ) latest WHERE NOT retired`;
  const { rows } = await database().query<Rubric>(`
    SELECT id,revision,label,definition,retired FROM ${source} ORDER BY label, id, revision DESC
  `);
  return rows;
}

type Change = { id: string } & (
  | { action: 'create' | 'revise'; expectedRevision: number; label: string; definition: RubricDefinition }
  | { action: 'retire'; expectedRevision: number }
);

export async function changeRubric(actor: string, change: Change) {
  const connection = await database().connect();
  const { id, expectedRevision } = change;
  try {
    await connection.query('BEGIN');
    await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 2155))', [id]);
    const { rows } = await connection.query<Rubric>(`
      SELECT id,revision,label,definition,retired FROM garden.rubric_templates WHERE id=$1 ORDER BY revision DESC LIMIT 1
    `, [id]);
    const latest = rows[0];
    let updated: Rubric;
    if (change.action === 'retire') {
      if (!latest || latest.revision !== expectedRevision) throw new RubricError(409, 'RUBRIC_CHANGED');
      if (latest.retired) {
        await connection.query('COMMIT');
        return latest;
      }
      const result = await connection.query<Rubric>(`
        UPDATE garden.rubric_templates SET retired=true WHERE id=$1 AND revision=$2
        RETURNING id,revision,label,definition,retired
      `, [id,latest.revision]);
      updated = result.rows[0];
    } else {
      const definition = JSON.stringify(change.definition);
      const revision = expectedRevision + 1;
      // A lost response can be retried against the exact previous edit.
      if (latest?.revision === revision && !latest.retired && latest.label === change.label) {
        const duplicate = await connection.query(`SELECT 1 FROM garden.rubric_templates
          WHERE id=$1 AND revision=$2 AND definition=$3::jsonb`, [id,revision,definition]);
        if (duplicate.rowCount) {
          await connection.query('COMMIT');
          return latest;
        }
      }
      if ((latest?.revision ?? 0) !== expectedRevision || latest?.retired) throw new RubricError(409, 'RUBRIC_CHANGED');
      const result = await connection.query<Rubric>(`
        INSERT INTO garden.rubric_templates(id,revision,label,definition,created_by) VALUES($1,$2,$3,$4,$5)
        RETURNING id,revision,label,definition,retired
      `, [id, revision, change.label, definition, actor]);
      updated = result.rows[0];
    }
    await connection.query(`INSERT INTO garden.audit_events(actor_id,action_code,target_kind,target_id,outcome)
      VALUES($1,'RUBRIC',$2,$3,'success')`, [actor, `rubric_${change.action}`, id]);
    await connection.query('COMMIT');
    return updated;
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}
