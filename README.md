# leviwiki-plugin

The Claude plugin for the LEVITUM wiki: the `wiki-search`, `wiki-builder` and `wiki-maintenance` skills,
their agents, and the entry for the LEVITUM MCP gateway.

**Who it is for:** LEVITUM e.V. members only. It does nothing without a LEVITUM gateway and a
Microsoft sign-in with your LEVITUM account.

## Install in Claude Code

Save your wiki token once on your gateway's `/enroll` page; it shows these commands with the gateway URL filled in.

```
claude plugin marketplace add LEVITUM-e-V/leviwiki-plugin
claude plugin install leviwiki@levitum --config mcp_url=<your gateway URL ending in /mcp>
```

Then sign in from Claude Code: `/mcp`, `plugin:leviwiki:leviwiki`, Authenticate. Update with
`claude plugin marketplace update levitum && claude plugin update leviwiki@levitum`.

## Claude Desktop and claude.ai

Not from this repository: members get the plugin zip from their gateway's `/enroll` page.

## This repository is generated

It is a copy generated from LEVITUM's private repository and is never edited by hand. Please do not open
pull requests against it; issues are welcome.

Licence: MIT, see `LICENSE`.
