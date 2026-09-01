# GoPic for Agents — WebMCP Challenge 2026

**See the sign. Find the real place.**

GoPic for Agents is a WebMCP-powered visual sign-to-place prototype.

Live demo: https://webmcp.gopic.app

## What it does

A human provides a storefront or sign photo.

GoPic reads the visible sign information, combines it with an optional location hint, produces candidate places, and returns a grounded place result.

The same workflow is exposed to compatible AI agents through WebMCP.

## WebMCP tools

The demo registers three tools:

- gopic_get_sign_context
- gopic_analyze_sign
- gopic_get_place_candidates

The main analysis tool returns structured OCR text, candidate places, and a grounded place result.

## Example

Location hint:

Nha Trang, Vietnam

Tested grounded result:

Chicken Plus 0515 - Vĩnh Điềm Trung

## Why WebMCP

OCR can read text, but reading a sign is not the same as identifying the correct real-world place.

GoPic exposes the sign-to-place workflow directly as structured WebMCP tools instead of requiring an agent to guess how to operate the webpage.

The implementation uses document.modelContext.registerTool().

## Challenge-specific work

GoPic existed before the challenge as a mobile product.

New work created for the WebMCP Challenge includes:

- standalone webmcp.gopic.app experience
- WebMCP tool registration
- agent-callable sign analysis
- shared human and agent sign context
- WebMCP Inspector validation
- challenge-specific web UI
- public challenge repository

The production GoPic mobile application source is private and is not included here.

## Project structure

- index.html
- assets/css/app.css
- webmcp/tools.js
- supabase/functions/webmcp-analyze-sign/index.ts
- README.md
- LICENSE

## Security

API credentials are not committed to this repository.

The live Gemini API key is stored only as a Supabase Edge Function secret and is never exposed to the browser or committed to this repository.

## License

MIT License.


