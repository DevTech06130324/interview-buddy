const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ASSISTANT_MUTATION_STATUS,
  AssistantMutationController
} = require('../src/assistantMutationController');

test('only one mutation lease can be active for a tab at a time', () => {
  const controller = new AssistantMutationController();
  const first = controller.acquire('tab-1');
  const second = controller.acquire('tab-1');

  assert.equal(first.status, ASSISTANT_MUTATION_STATUS.ACQUIRED);
  assert.equal(second.status, ASSISTANT_MUTATION_STATUS.BUSY);
  assert.equal(controller.isActive('tab-1'), true);
  assert.equal(first.release(), true);
  assert.equal(controller.isActive('tab-1'), false);
});

test('a stale or repeated lease release cannot unlock a newer mutation', () => {
  const controller = new AssistantMutationController();
  const first = controller.acquire('tab-1');

  assert.equal(first.release(), true);
  const second = controller.acquire('tab-1');

  assert.equal(first.release(), false);
  assert.equal(controller.isActive('tab-1'), true);
  assert.equal(second.release(), true);
  assert.equal(second.release(), false);
});

test('explicit tab cleanup releases an in-flight mutation after a tab close or renderer loss', () => {
  const controller = new AssistantMutationController();
  const lease = controller.acquire('tab-1');

  assert.equal(controller.release('tab-1'), true);
  assert.equal(controller.isActive('tab-1'), false);
  assert.equal(lease.release(), false, 'the stale operation cannot unlock a later lease');
  assert.equal(controller.release('tab-1'), false);
});

test('mutations on different tabs may run independently', () => {
  const controller = new AssistantMutationController();
  const first = controller.acquire('tab-1');
  const second = controller.acquire('tab-2');

  assert.equal(first.status, ASSISTANT_MUTATION_STATUS.ACQUIRED);
  assert.equal(second.status, ASSISTANT_MUTATION_STATUS.ACQUIRED);
  assert.equal(first.release(), true);
  assert.equal(second.release(), true);
});

test('run releases the tab after a successful operation', async () => {
  const controller = new AssistantMutationController();

  const result = await controller.run('tab-1', async () => 'sent');

  assert.deepEqual(result, {
    status: ASSISTANT_MUTATION_STATUS.COMPLETED,
    tabId: 'tab-1',
    value: 'sent'
  });
  assert.equal(controller.isActive('tab-1'), false);
});

test('run releases the tab after an operation error and reports it without leaking a lease', async () => {
  const controller = new AssistantMutationController();
  const failure = new Error('upload failed');

  const result = await controller.run('tab-1', async () => {
    throw failure;
  });

  assert.equal(result.status, ASSISTANT_MUTATION_STATUS.FAILED);
  assert.equal(result.tabId, 'tab-1');
  assert.equal(result.error, failure);
  assert.equal(controller.isActive('tab-1'), false);
  assert.equal(controller.acquire('tab-1').status, ASSISTANT_MUTATION_STATUS.ACQUIRED);
});

test('a later operation receives the deterministic busy result while run is pending', async () => {
  const controller = new AssistantMutationController();
  let completeFirst;
  const first = controller.run('tab-1', () => new Promise((resolve) => {
    completeFirst = resolve;
  }));

  assert.deepEqual(await controller.run('tab-1', async () => 'should not run'), {
    status: ASSISTANT_MUTATION_STATUS.BUSY,
    tabId: 'tab-1'
  });

  completeFirst('first done');
  assert.equal((await first).status, ASSISTANT_MUTATION_STATUS.COMPLETED);
});
