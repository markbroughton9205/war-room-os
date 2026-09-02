# WR Council Stream Normalization

War Room does not parse every vendor as OpenAI.

Anthropic uses `content_block_delta` with `text_delta`. OpenAI and xAI use `choices[].delta.content`. Gemini uses `streamGenerateContent?alt=sse`. All normalize to `TEXT_DELTA` on the existing Council SSE progress channel. Hidden reasoning is not streamed.

