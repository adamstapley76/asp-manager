# ASP Manager private ChatGPT app

This MCP server lets ordinary ChatGPT conversations create ASP Manager quotes after Adam approves the action.

## Private MCP endpoint

`https://asp-manager-git-daily-driver-bugfix-2-adamstapley.vercel.app/api/mcp`

## Authentication

Configure the private app to send this header. The value is the existing private Vercel environment variable and must never be put in this document, the repository, or a chat message.

`Authorization: Bearer <CHATGPT_QUOTE_API_TOKEN>`

## Tool behaviour

The server exposes one write tool: `create_quote_in_asp_manager`.

It only creates a record when the user has explicitly asked to send a confirmed quote. It preserves missing details as missing, matches customers before creating them, and returns an ASP Manager review link. Repeating the same package returns the existing quote rather than creating a duplicate.

## Photo limitation

The tool can store supplied permanent HTTPS photo URLs. A temporary ChatGPT attachment URL must not be treated as a permanent photo reference, so quote creation continues without it.
