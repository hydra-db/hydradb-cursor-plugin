import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig, DEFAULTS } from "../scripts/lib/config.mjs";
import { syncWorkspace } from "../scripts/lib/workspace-sync.mjs";
import { buildHydraContextBlock } from "../scripts/lib/context-format.mjs";
import { createHydraWrapper } from "../scripts/lib/hydra/index.mjs";
import { HydraClient, normalizeRetrievalResponse } from "../scripts/lib/hydra-client.mjs";

const unifiedFixture = {
  chunks: [{ chunk_id: "chunk-1", context_id: "context-1", content: "whole content", score: 0.8,
    enrichment: "whole enrichment", received_at: "2026-11-19T00:00:00Z" }],
  graph: [{ origin: "query_path", path_summary: "summary", triplets: [{
    source: { entity_id: "entity-1", name: "one" },
    relation: { predicate: "uses", context: "evidence", relationship_id: "edge-1", chunk_id: "chunk-1", timestamp: 1.5 },
    target: { entity_id: "entity-2", name: "two" }
  }] }],
  forceful_relations: [{ via: { from: "context-1", to: "context-2" }, chunk: {
    chunk_id: "chunk-2", context_id: "context-2", content: "linked content", score: 0.7
  } }],
  llm_prompt: "  Server prompt\r\n" + "complete content ".repeat(800) + "\r\n  ",
  tabular_data: { records: [{ customerID: 1, customer_id: 2, nestedMap: { keyID: 3 } }] }
};

test("unified query survives the real SDK and is read by shape in either layout", async () => {
  for (const layout of ["split", "unified"]) {
    let sent;
    const client = new HydraClient({ apiKey: "test-key", tenantId: "db", layout, fetch: async (url, init) => {
      sent = JSON.parse(init.body);
      assert.equal(new Headers(init.headers).get("API-Version"), "2");
      return Response.json({ success: true, data: unifiedFixture });
    } });
    const result = await client.recallKnowledge("q");
    assert.equal(result.layout, "unified");
    assert.deepEqual(result.chunks, unifiedFixture.chunks);
    assert.deepEqual(result.graph, unifiedFixture.graph);
    assert.deepEqual(result.forceful_relations, unifiedFixture.forceful_relations);
    assert.deepEqual(result.tabular_data, unifiedFixture.tabular_data);
    assert.equal(result.llmPrompt, unifiedFixture.llm_prompt);
    assert.equal(sent.type, layout === "split" ? "knowledge" : undefined);
    assert.equal(buildHydraContextBlock({ query: "q", unified: result, maxContextChars: 512 }), unifiedFixture.llm_prompt);
  }
});

test("unified real-SDK responses redact credentials without rewriting opaque keys or dropping warnings", async () => {
  const credential = "registered-test-credential-value";
  const fixture = structuredClone(unifiedFixture);
  fixture.chunks[0].content = `stored ${credential}`;
  fixture.graph[0].path_summary = `graph ${credential}`;
  fixture.tabular_data.records[0] = { customerID: "one", customer_id: "two", nestedMap: { keyID: "safe", admin_password: "sensitive" }, text: credential };
  fixture.llm_prompt = `prompt ${credential}`;
  const client = new HydraClient({ apiKey: credential, tenantId: "db", layout: "unified", fetch: async () =>
    Response.json({ success: true, data: fixture, meta: { warnings: [{ code: "partial", collections: ["collection"] }] } }) });
  const result = await client.recallKnowledge("q");
  assert.ok(!JSON.stringify(result).includes(credential));
  assert.equal(result.tabular_data.records[0].customerID, "one");
  assert.equal(result.tabular_data.records[0].customer_id, "two");
  assert.equal(result.tabular_data.records[0].nestedMap.keyID, "safe");
  assert.equal(result.tabular_data.records[0].nestedMap.admin_password, "[REDACTED]");
  assert.deepEqual(result.warnings, [{ code: "partial", collections: ["collection"] }]);
  assert.ok(!buildHydraContextBlock({ unified: result }).includes(credential));
});

test("unified existing methods reject unsupported input before mapping or dispatch", async () => {
  let calls = 0;
  const client = new HydraClient({ layout: "unified", fetch: async () => { calls++; throw new Error("must not dispatch"); } });
  await assert.rejects(() => client.addMemories([{ text: "body", unknown_body: "lost" }]), /unsupported/);
  await assert.rejects(() => client.addMemories([{ user_assistant_pairs: [{ user: "hello", assistant: "world", extra: "lost" }] }]), /unsupported/);
  await assert.rejects(() => client.uploadKnowledge([{ content: { html: "<b>lost</b>" } }]), /rich content/);
  await assert.rejects(() => client.uploadKnowledge([{ content: { text: "body" }, extra: "lost" }]), /unsupported/);
  assert.equal(calls, 0);
});

test("unified layout sends existing writes as canonical JSON through the SDK", async () => {
  const sent = [];
  const client = new HydraClient({ apiKey: "test-key", tenantId: "db", subTenantId: "collection", layout: "unified",
    fetch: async (url, init) => {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("content-type"), "application/json");
      assert.equal(headers.get("authorization"), "Bearer test-key");
      assert.equal(headers.get("API-Version"), "2");
      assert.ok(init.signal instanceof AbortSignal);
      const body = JSON.parse(init.body);
      sent.push(body);
      assert.equal(body.database, "db");
      assert.equal(body.collection, "collection");
      assert.equal(body.type, undefined);
      assert.equal(body.kind, undefined);
      for (const item of body.context) {
        assert.equal(Boolean(item.text) !== Boolean(item.conversation), true);
        for (const key of ["metadata", "additional_metadata", "context_category", "type", "kind"]) assert.equal(item[key], undefined);
      }
      return Response.json({ success: true, data: { results: body.context.map(item => ({ id: item.context_id, status: "queued" })), success_count: body.context.length, failed_count: 0 } }, { status: 202 });
    } });
  await client.addTextMemory("note", { sourceId: "note-id", infer: false });
  await client.addConversationMemory("question", "answer", { sourceId: "turn-id", userName: "Ada" });
  await client.uploadKnowledge([{ id: "file-id", title: "file.md", content: { text: "workspace content" },
    metadata: { customerID: 1, customer_id: 2 }, additional_metadata: { nestedMap: { keyID: 3 } }, timestamp: "2026-11-19T00:00:00Z", url: "hydradb://workspace/file.md" }]);
  assert.equal(sent.length, 3);
  assert.equal(sent[0].context[0].context_id, "note-id");
  assert.equal(sent[0].context[0].enrich, false);
  assert.deepEqual(sent[1].context[0].conversation, [{ role: "user", content: "question" }, { role: "assistant", content: "answer" }]);
  assert.equal(sent[1].context[0].user_name, "Ada");
  assert.deepEqual(sent[2].context[0].attributes, { customerID: 1, customer_id: 2 });
  assert.deepEqual(sent[2].context[0].custom_attributes.nestedMap, { keyID: 3 });
  assert.equal(sent[2].context[0].happened_at, undefined);
  assert.equal(sent[2].context[0].custom_attributes.original_timestamp, "2026-11-19T00:00:00Z");
});

test("unified ingest reconciles acknowledgements and batches at the runtime limit", async () => {
  const sizes = [];
  const client = new HydraClient({ apiKey: "test-key", tenantId: "db", layout: "unified", fetch: async (_, init) => {
    const body = JSON.parse(init.body);
    sizes.push(body.context.length);
    return Response.json({ success: true, data: { results: body.context.filter(item => item.context_id !== "id-1")
      .map(item => ({ id: item.context_id, status: "queued" })) } }, { status: 202 });
  } });
  const result = await client.addMemories(Array.from({ length: 101 }, (_, i) => ({ source_id: `id-${i}`, text: "note" })));
  assert.deepEqual(sizes, [100, 1]);
  assert.deepEqual(result.failedIds, ["id-1"]);
  assert.equal(result.acceptedIds.length, 100);
  await assert.rejects(() => client.addTextMemory("x".repeat(1048577)), /maximum|MiB|large/i);
  assert.equal(sizes.length, 2);
});

test("unified delete preserves per-id reconciliation without a split selector", async () => {
  const client = new HydraClient({ apiKey: "test-key", tenantId: "db", layout: "unified", fetch: async (_, init) => {
    assert.equal(init.method, "DELETE");
    assert.equal(JSON.parse(init.body).type, undefined);
    return Response.json({ success: true, data: { results: [{ id: "a", deleted: true }, { id: "b", deleted: false }] } });
  } });
  const result = await client.deleteKnowledge(["a", "b"]);
  assert.deepEqual(result.deletedIds, ["a"]);
  assert.deepEqual(result.failedIds, ["b"]);
});

test("layout is explicit and failed split writes are never retried as unified", async () => {
  assert.throws(() => new HydraClient({ layout: "auto" }), /layout/i);
  let calls = 0;
  const client = new HydraClient({ apiKey: "test-key", tenantId: "db", fetch: async () => {
    calls++;
    return Response.json({ error: "this database is unified: send context[]" }, { status: 400 });
  } });
  await assert.rejects(() => client.addTextMemory("note"), /400/);
  assert.equal(calls, 1);
});

test("unified SDK bridges isolate concurrent requests and retain SDK errors and aborts", async () => {
  const seen = [];
  const client = new HydraClient({ apiKey: "test-key", tenantId: "db", layout: "unified", writeTimeoutMs: 10,
    fetch: async (_, init) => {
      const body = JSON.parse(init.body);
      seen.push(body);
      if (body.context[0].text === "refuse") return Response.json({ error: "refused" }, { status: 400 });
      if (body.context[0].text === "abort") return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
      await Promise.resolve();
      return Response.json({ success: true, data: { results: body.context.map(item => ({ id: item.context_id, status: "queued" })) } }, { status: 202 });
    } });
  await Promise.all([client.addTextMemory("first", { sourceId: "first" }), client.addTextMemory("second", { sourceId: "second" })]);
  assert.deepEqual(seen.map(body => body.context[0].context_id).sort(), ["first", "second"]);
  await assert.rejects(() => client.addTextMemory("refuse"), /400/);
  await assert.rejects(() => client.addTextMemory("abort"), /timed out|abort/i);
  assert.equal(seen.length, 4);
});

test("layout config and env select one unified query without changing host JSON", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hydradb-unified-"));
  const saved = process.env.HYDRADB_LAYOUT;
  try {
    await fs.writeFile(path.join(directory, "config.json"), JSON.stringify({ apiKey: "test-key", tenantId: "db" }));
    process.env.HYDRADB_LAYOUT = "unified";
    assert.equal((await loadConfig(directory, directory)).config.layout, "unified");
    process.env.HYDRADB_LAYOUT = "automatic";
    assert.ok((await loadConfig(directory, directory)).errors.some(message => message.includes("layout")));
    assert.equal((await loadConfig(directory, directory)).configured, false);
    const code = `
      import assert from 'node:assert/strict';
      let calls = 0;
      globalThis.fetch = async (url, init) => {
        calls++;
        assert.ok(String(url).endsWith('/query'));
        assert.equal(JSON.parse(init.body).type, undefined);
        return Response.json({success:true,data:${JSON.stringify(unifiedFixture)}});
      };
      process.argv = ['node', 'plugin', 'user-prompt-submit'];
      process.on('beforeExit', () => assert.equal(calls, 1));
      await import(${JSON.stringify(new URL("../scripts/plugin.mjs", import.meta.url).href)});
    `;
    const output = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: directory, encoding: "utf8", input: JSON.stringify({ session_id: "unified-test", prompt: "question" }),
      env: { ...process.env, HYDRADB_HOOK_FORMAT: "cursor", HYDRADB_LAYOUT: "unified", HYDRADB_API_KEY: "test-key", HYDRADB_DATABASE: "db",
        HYDRADB_SEARCH_MODE: "both", CLAUDE_PLUGIN_DATA: directory, PLUGIN_ROOT: path.resolve(new URL("..", import.meta.url).pathname) }
    }));
    assert.equal(output.hookSpecificOutput?.additionalContext ?? output.additional_context, unifiedFixture.llm_prompt);
  } finally {
    if (saved == null) delete process.env.HYDRADB_LAYOUT; else process.env.HYDRADB_LAYOUT = saved;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("unified workspace partial acknowledgement rolls back without stamping unchanged state", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hydradb-unified-sync-"));
  try {
    await fs.writeFile(path.join(directory, "doc.md"), "# Document\n" + "paragraph ".repeat(35));
    const calls = [];
    const client = new HydraClient({ apiKey: "test-key", tenantId: "db", layout: "unified", fetch: async (_, init) => {
      const body = JSON.parse(init.body);
      calls.push({ method: init.method, body });
      if (init.method === "DELETE") return Response.json({ success: true, data: { results: body.ids.map(id => ({ id, deleted: true })) } });
      return Response.json({ success: true, data: { results: [{ id: body.context[0].context_id, status: "queued" }] } }, { status: 202 });
    } });
    const state = { files: {}, sessions: {} };
    const summary = await syncWorkspace({ client, config: { ...DEFAULTS, layout: "unified", maxMemoryCharsPerChunk: 120 }, projectRoot: directory,
      workspaceName: "workspace", state });
    assert.equal(summary.synced, 0);
    assert.deepEqual(state.files, {});
    assert.equal(calls[0].body.context.length > 1, true);
    assert.equal(calls[1].method, "DELETE");
    assert.deepEqual(calls[1].body.ids, [calls[0].body.context[0].context_id]);
    assert.equal(calls[1].body.type, undefined);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("unified knowledge workspace preserves mtime provenance without inventing an event date", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hydradb-unified-knowledge-"));
  try {
    const file = path.join(directory, "doc.md");
    await fs.writeFile(file, "# Workspace content");
    const client = new HydraClient({ apiKey: "test-key", tenantId: "db", subTenantId: "collection", layout: "unified", fetch: async (_, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.database, "db");
      assert.equal(body.collection, "collection");
      const item = body.context[0];
      assert.equal(item.happened_at, undefined);
      assert.equal(item.tenant_id, undefined);
      assert.equal(item.sub_tenant_id, undefined);
      assert.equal(item.custom_attributes.original_timestamp, new Date((await fs.stat(file)).mtimeMs).toISOString());
      const reserved = new Set("chunk_id sub_tenant_id source_id chunk_content chunk_content_embedding chunk_content_sparse source_title source_url source_upload_time source_last_updated_time source_type source_collection source_owner source_collaborator description description_embedding inferred_content inferred_content_embedding base_metadata layout document_metadata document_metadata_embedding embedding metadata evidence_kind evidence_subject chunk_level parent_chunk_id chunk_generation".split(" "));
      for (const map of [item.attributes, item.custom_attributes]) {
        for (const key of Object.keys(map)) assert.ok(!reserved.has(key.toLowerCase()), `${key} is reserved by the pinned runtime`);
      }
      assert.ok(Buffer.byteLength(JSON.stringify(item.custom_attributes)) <= 1024);
      assert.equal(item.custom_attributes.description, undefined);
      assert.equal(item.custom_attributes.original_description, "Workspace context synced from workspace");
      return Response.json({ success: true, data: { results: [{ id: item.context_id, status: "queued" }] } }, { status: 202 });
    } });
    const state = { files: {}, sessions: {} };
    const args = { client, config: { ...DEFAULTS, layout: "unified", ingestionMode: "knowledge" }, projectRoot: directory, workspaceName: "workspace", state };
    assert.equal((await syncWorkspace(args)).synced, 1);
    const tracked = structuredClone(state.files[file]);
    assert.equal((await syncWorkspace(args)).synced, 0);
    assert.deepEqual(state.files[file], tracked);
    await assert.rejects(() => client.uploadKnowledge([{ content: { text: "body" }, tenant_id: "another" }]), /conflicts/);
    await assert.rejects(() => client.uploadKnowledge([{ content: { text: "body" }, sub_tenant_id: "another" }]), /conflicts/);
    await assert.rejects(() => client.addMemories([{ text: "body", observation_date: "2026-11-19T00:00:00Z" }]), /YYYY-MM-DD/);
    await assert.rejects(() => client.uploadKnowledge([{ content: { text: "body" }, description: "provenance", additional_metadata: { original_description: "caller value" } }]), /conflict/);
    await assert.rejects(() => client.uploadKnowledge([{ content: { text: "body" }, additional_metadata: { note: "x".repeat(1024) } }]), /1024|1 KiB/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("query forwards additive options and preserves envelope warnings", async () => {
  let request;
  const wrapper = createHydraWrapper({ sdkClient: { query: async (args) => {
    request = args;
    return { success: true, data: { chunks: [] }, meta: { warnings: [{ code: "partial", collections: ["c"] }] } };
  } } });
  const result = await wrapper.context.query({ query: "q", include_table_sql: false, table_limit: 0 });
  assert.equal(request.includeTableSql, false);
  assert.equal(request.tableLimit, 0);
  assert.deepEqual(result.warnings, [{ code: "partial", collections: ["c"] }]);
});

test("retrieval exposes additive structured fields", () => {
  const result = normalizeRetrievalResponse({
    chunks: [{ text: "x", chunk_metadata: { page: 2 } }],
    tabular_data: [{ rows: [[1]] }], temporal_facts: [{ observed_at: "2025-01-01" }],
    graph_context: { query_paths: [{ triplets: [{ source: { name: "a", database: "db", collection: "c", source_id: "s", read_status: "ready" }, relation: { canonical_predicate: "is" }, target: { name: "b" } }] }] },
    warnings: [{ code: "partial", collections: ["c"] }]
  });
  assert.deepEqual(result.chunks[0].chunkMetadata, { page: 2 });
  assert.deepEqual(result.tabularData, [{ rows: [[1]] }]);
  assert.equal(result.temporalFacts[0].observed_at, "2025-01-01");
  assert.deepEqual(result.warnings[0].collections, ["c"]);
  assert.equal(result.graphContext.queryPathsDetailed[0].triplets[0].source.database, "db");
});

test("recall forwards snake_case options through its wrapper", async () => {
  let request;
  const client = new HydraClient({ sdkClient: { query: async (args) => {
    request = args;
    return { success: true, data: { chunks: [] } };
  } } });
  await client.recallKnowledge("q", { include_table_sql: true, table_limit: 7 });
  assert.equal(request.includeTableSql, true);
  assert.equal(request.tableLimit, 7);
});

test("HydraClient preserves metadata keys and redacts sensitive properties", async () => {
  const metadata = {
    customerID: "first", customer_id: "second", nestedMap: {
      customerID: 1, customer_id: 2, token_count: 120, tokenizer: "cl100k_base", password: "short", token: 123,
      secret: { nested: "hidden" }, api_key: "abc", "API key": "def",
      authorization: "bearer", cookie: ["session"], private_key: "key",
      safeText: "password=verylongpassword"
    }, list: [{ accessToken: "secret value", validKey: "visible" }]
  };
  for (const field of ["chunkMetadata", "chunk_metadata"]) {
    const client = new HydraClient({ sdkClient: { query: async () => ({
      success: true, data: { chunks: [{ chunkContent: "hello", [field]: metadata }] }
    }) } });
    const result = await client.recallKnowledge("q");
    const actual = result.chunks[0].chunkMetadata;
    assert.equal(actual.customerID, "first");
    assert.equal(actual.customer_id, "second");
    assert.equal(actual.nestedMap.customerID, 1);
    assert.equal(actual.nestedMap.customer_id, 2);
    assert.equal(actual.nestedMap.token_count, 120);
    assert.equal(actual.nestedMap.tokenizer, "cl100k_base");
    for (const key of ["password", "token", "secret", "api_key", "API key", "authorization", "cookie", "private_key"]) {
      assert.equal(actual.nestedMap[key], "[REDACTED]");
    }
    assert.equal(actual.nestedMap.safeText, "[REDACTED:generic-secret]");
    assert.deepEqual(actual.list, [{ accessToken: "[REDACTED]", validKey: "visible" }]);
  }
});

test("vendored SDK recall retains and redacts wire metadata", async () => {
  const client = new HydraClient({ apiKey: "test-key", tenantId: "test-db", fetch: async () =>
    new Response(JSON.stringify({ success: true, data: { chunks: [{
      chunk_content: "hello", chunk_metadata: { customerID: "one", customer_id: "two", password: "short" }
    }] } }), { status: 200, headers: { "content-type": "application/json" } })
  });
  const result = await client.recallKnowledge("q");
  assert.deepEqual(result.chunks[0].chunkMetadata, {
    customerID: "one", customer_id: "two", password: "[REDACTED]"
  });
});

test("real SDK serializes per-request table options and preserves record keys", async () => {
  const sent = [];
  const client = new HydraClient({ apiKey: "test-key", tenantId: "db", fetch: async (url, init) => {
    sent.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ success: true, data: { chunks: [],
      tabular_data: { records: [{ customerID: 1, customer_id: 2, nestedMap: { fieldID: 3, field_id: 4 } }] }
    } }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const [a, b] = await Promise.all([
    client.recallKnowledge("a", { include_table_sql: false, table_limit: 0 }),
    client.recallKnowledge("b", { include_table_sql: true, table_limit: 9 })
  ]);
  assert.deepEqual(a.tabularData.records[0], { customerID: 1, customer_id: 2, nestedMap: { fieldID: 3, field_id: 4 } });
  assert.deepEqual(b.tabularData, a.tabularData);
  assert.deepEqual(sent.map(x => [x.body.query, x.body.include_table_sql, x.body.table_limit]).sort(), [["a", false, 0], ["b", true, 9]]);
  assert.ok(sent.every(x => x.init.signal && x.init.method === "POST"));
  assert.ok(sent.every(x => new Headers(x.init.headers).get("authorization")));
});

test("agent context includes bounded table and warnings from real recall", async () => {
  async function recall(data, warnings) {
    const client = new HydraClient({ apiKey: "test-key", tenantId: "db", fetch: async () =>
      new Response(JSON.stringify({ success: true, data, meta: { warnings } }), { status: 200, headers: { "content-type": "application/json" } }) });
    return client.recallKnowledge("q");
  }
  const table = { records: [{ customerID: "A", customer_id: "B" }] };
  for (const data of [{ chunks: [], tabular_data: table }, { chunks: [{ chunk_content: "prose" }], tabular_data: table, llm_prompt: "server prompt" }]) {
    const result = await recall(data, [{ code: "PARTIAL", message: "incomplete", collections: ["db"] }]);
    const context = buildHydraContextBlock({ query: "q", knowledge: result, maxContextChars: 3000 });
    assert.match(context, /customerID/); assert.match(context, /customer_id/);
    assert.match(context, /PARTIAL/); assert.match(context, /incomplete/);
    if (data.chunks.length) assert.match(context, /prose|server prompt/);
  }
  const warningOnly = await recall({ chunks: [] }, [{ code: "PARTIAL", message: "incomplete" }]);
  assert.match(buildHydraContextBlock({ query: "q", knowledge: warningOnly, maxContextChars: 3000 }), /PARTIAL/);
  const huge = await recall({ chunks: [], tabular_data: { records: Array.from({length: 100}, (_, i) => ({ value: "x".repeat(300), i })) } }, []);
  const context = buildHydraContextBlock({ query: "q", knowledge: huge, maxContextChars: 1200 });
  assert.ok(context.length <= 1200); assert.match(context, /omitted/i);
});

test("table bridge preserves SDK error handling and timeout cancellation", async () => {
  let calls = 0;
  const failing = new HydraClient({ apiKey: "test", tenantId: "db", fetch: async () => {
    calls += 1;
    return new Response(JSON.stringify({ message: "denied" }), { status: 403, headers: { "content-type": "application/json" } });
  } });
  await assert.rejects(failing.recallKnowledge("q", { include_table_sql: true }), /403/);
  assert.equal(calls, 1);
  let aborted = false;
  const slow = new HydraClient({ apiKey: "test", tenantId: "db", requestTimeoutMs: 5, fetch: async (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => {
      aborted = true; reject(new DOMException("aborted", "AbortError"));
    }, { once: true }))
  });
  await assert.rejects(slow.recallKnowledge("q", { table_limit: 2 }), /timed out|aborted|timeout/i);
  assert.equal(aborted, true);
});

test("table records and agent context redact segmented credentials without erasing metadata", async () => {
  const record = {
    admin_password: "p@ss", signing_secret: "signing", aws_secret_access_key: "aws-key",
    secret_key: "secret-key-value", webhook_secret: "webhook-value",
    "x-api-key": "header-api-value", personal_access_token: "personal-token-value",
    dbPrivateKey: { value: "private-value" }, authorization_header: "auth-value", session_cookie: "cookie-value",
    token_count: 120, tokenizer: "cl100k_base", cookie_policy_enabled: true
  };
  const client = new HydraClient({ apiKey: "test", tenantId: "db", fetch: async () =>
    new Response(JSON.stringify({ success: true, data: { chunks: [], tabular_data: { records: [record] } } }),
      { status: 200, headers: { "content-type": "application/json" } })
  });
  const result = await client.recallKnowledge("q");
  const actual = result.tabularData.records[0];
  for (const key of ["admin_password", "signing_secret", "aws_secret_access_key", "secret_key", "webhook_secret", "x-api-key", "personal_access_token", "dbPrivateKey", "authorization_header", "session_cookie"]) {
    assert.equal(actual[key], "[REDACTED]", key);
  }
  assert.equal(actual.token_count, 120);
  assert.equal(actual.tokenizer, "cl100k_base");
  assert.equal(actual.cookie_policy_enabled, true);
  const text = buildHydraContextBlock({ query: "q", knowledge: result, maxContextChars: 3000 });
  for (const secret of ["p@ss", "signing\"", "aws-key", "secret-key-value", "webhook-value", "header-api-value", "personal-token-value", "private-value", "auth-value", "cookie-value"]) assert.ok(!text.includes(secret), secret);
  assert.match(text, /"token_count":120/);
  assert.match(text, /"tokenizer":"cl100k_base"/);
  assert.match(text, /"cookie_policy_enabled":true/);
});

test("compact legacy credential names are redacted in records and agent context", async () => {
  const record = { accesstoken: "compact-token-value", clientsecret: "compact-secret-value",
    dbpassword: "compact-db-value", AUTHPASSWORD: "compact-auth-value", DBPASSWORD: "compact-upper-db-value",
    token_count: 120, tokenizer: "cl100k_base", tokencount: 121, cookie_policy_enabled: true };
  const client = new HydraClient({ apiKey: "test", tenantId: "db", fetch: async () =>
    new Response(JSON.stringify({ success: true, data: { chunks: [], tabular_data: { records: [record] } } }),
      { status: 200, headers: { "content-type": "application/json" } }) });
  const result = await client.recallKnowledge("q");
  const actual = result.tabularData.records[0];
  for (const key of ["accesstoken", "clientsecret", "dbpassword", "AUTHPASSWORD", "DBPASSWORD"]) {
    assert.equal(actual[key], "[REDACTED]", key);
  }
  assert.equal(actual.token_count, 120);
  assert.equal(actual.tokenizer, "cl100k_base");
  assert.equal(actual.tokencount, 121);
  assert.equal(actual.cookie_policy_enabled, true);
  const context = buildHydraContextBlock({ query: "q", knowledge: result, maxContextChars: 3000 });
  for (const key of ["accesstoken", "clientsecret", "dbpassword", "AUTHPASSWORD", "DBPASSWORD"]) {
    assert.ok(!context.includes(record[key]), key);
    assert.ok(context.includes(`"${key}":"[REDACTED]"`), key);
  }
  assert.match(context, /"token_count":120/);
  assert.match(context, /"tokenizer":"cl100k_base"/);
  assert.match(context, /"tokencount":121/);
  assert.match(context, /"cookie_policy_enabled":true/);
});
