// Playwright CLI fixture: real UI/API calls, deterministic fake responses.
// Never forwards /api or non-local network requests; never accesses Lift.
async (page) => {
  const order = await page.evaluate(async () => {
    const { demoOrder } = await import('/src/demo.ts');
    const result = structuredClone(demoOrder);
    result.order_title = 'Quantity approval QA';
    result.last_synced_at = new Date().toISOString();
    result.access = { scope: 'review', decisions_enabled: true, allocation_enabled: true, review_experience: 'advanced', revision_upload_enabled: true };
    result.tasks = result.tasks.slice(0, 2).map((task, index) => ({ ...task, attachment_id: String(201 + index), version: 1, quantity: 10, sibling_count: 2, feedback_required: false, feedback_acknowledged: true,
      current_version: { ...task.current_version, comments: [], version_id: 'pversion_' + (201 + index) } }));
    result.counts = { pending: 2, regenerating: 0, waiting: 0, reviewed: 0, total: 2 };
    return result;
  });
  let batch = null;
  let advanceCount = 0;
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5184') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let body;
    if (url.pathname === '/api/public/proof/order') body = { order, participant: { participant_id: 'test-reviewer', display_name: 'QA Reviewer', email: 'qa@example.invalid' }, activity: { identified_reviewers: 1, last_activity_at: null, reviewer_names_visible: false }, session_expires_at: new Date(Date.now() + 3600000).toISOString(), refresh_queued: false };
    else if (url.pathname.endsWith('/approval-batches') && route.request().method() === 'GET') body = { batches: batch ? [batch] : [] };
    else if (url.pathname.endsWith('/approval-batches') && route.request().method() === 'POST') {
      const request = route.request().postDataJSON();
      batch = { batch_id: 'pbatch_test', state: 'ready', source_line_number: '1', line_quantity: 10, entries: request.entries.map(entry => ({ ...entry, filename: order.tasks.find(t => t.task_id === entry.task_id).current_version.filename, state: 'pending', resulting_line_number: null })) };
      body = { batch };
    } else if (url.pathname.endsWith('/advance')) {
      advanceCount++;
      // Deliberately delay confirmation so reload/close recovery can be checked.
      if (advanceCount === 1) { batch.state = 'checking'; batch.entries[0].state = 'submitted'; }
      if (advanceCount === 10) { batch.state = 'ready'; batch.entries[0].state = 'confirmed'; batch.entries[0].resulting_line_number = '2'; }
      if (advanceCount === 11) { batch.state = 'checking'; batch.entries[1].state = 'submitted'; }
      if (advanceCount >= 12) { batch.state = 'completed'; batch.entries[1].state = 'confirmed'; batch.entries[1].resulting_line_number = '1'; }
      body = { batch };
    } else return route.fulfill({ status: 404, json: { error: 'Not part of this isolated QA fixture' } });
    return route.fulfill({ status: 200, json: body });
  });
  await page.goto('http://127.0.0.1:5184/#/proof');
  await page.reload();
}
