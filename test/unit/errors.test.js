import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FleetError, friendlyErrorMessage } from '../../dist/errors.js';
import { AgentError } from '../../dist/v1/errors.js';

describe('friendly errors', () => {
  test('explains a busy workspace and a missing protocol match', () => {
    assert.match(
      friendlyErrorMessage(new AgentError('WORKSPACE_BUSY', 'WORKSPACE_BUSY {}', true)),
      /Another Fleet operation/,
    );
    assert.match(
      friendlyErrorMessage(new AgentError('INVALID_FRAME', 'frame payload 1048588 exceeds 1048576')),
      /same version/,
    );
  });

  test('includes a configuration hint', () => {
    assert.match(
      friendlyErrorMessage(new FleetError('config-missing', 'no Fleet project configuration', {
        hint: 'run `fleet init`',
      })),
      /run `fleet init`/,
    );
  });
});
