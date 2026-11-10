// Parses every GraphQL query of the Suwayomi connector (syntax check only).
import { parse } from 'graphql';
import { Q } from '../../app/js/connectors/suwayomi-queries.js';

for (const [k, q] of Object.entries(Q)) {
  try {
    const d = parse(q);
    const op = d.definitions.find((x) => x.kind === 'OperationDefinition');
    if (op.name.value !== k) throw new Error('operation name differs from key');
  } catch (e) {
    console.log('ERR', k, e.message);
    process.exitCode = 1;
  }
}
console.log('parsed', Object.keys(Q).length);
