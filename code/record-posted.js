// Record Posted — runs after the publish step.
// Persists the published story so future runs won't repeat it (idempotency).
const staticData = $getWorkflowStaticData('global');
const parsed = $('Parse Claude Response').item.json;

staticData.postedLinks = [...(staticData.postedLinks || []), parsed.source_link].slice(-50);
staticData.postedHeadlines = [...(staticData.postedHeadlines || []), parsed.headline].slice(-20);

return [{ json: { recorded: true, headline: parsed.headline } }];
