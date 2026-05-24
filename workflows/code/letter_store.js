// Node: Parse & Store Letter
// Position: After OpenAI LLM node (v1.3 format — message.content)
// Parses the letter body and prepares the Postgres INSERT payload
// Output: 1 item with session + body (SQL-escaped) for the INSERT node

const raw       = $input.first().json;
const buildNode = $("Build Letter Prompt").first().json;

// OpenAI native node v1.3 output shape: { message: { content: "..." } }
const letterText = raw.message?.content || '';
const sessionId  = buildNode.session_id;

// SQL-escape single quotes for string interpolation in the Postgres node
const sqlEsc = s => (s || '').replace(/'/g, "''");

return [{
  json: {
    session: sessionId,
    body:    sqlEsc(letterText.trim()),
  }
}];
