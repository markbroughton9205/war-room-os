"""STAGE3A post-review evaluation-only sets. Frozen before scoring. Never used for training.

Does not mutate CAP-EVAL-0 or WRIM-EVAL-S3-000001.
"""
from __future__ import annotations

from typing import Any

RETENTION_SUITE_ID = "WRIM-EVAL-S3A-RET-000001"
STRUCT_SUITE_ID = "WRIM-EVAL-S3A-STRUCT-000001"
SUITE_VERSION = "1.0.0"
CREATED_AT = "2026-09-13T16:00:00+00:00"
AUTHORSHIP = (
    "Authored synthetic STAGE3A post-review evaluation stems. "
    "Evaluation-only. Not sliced from WR-CORPUS-0 or WR-CORPUS-1. "
    "Not CAP-EVAL-0. Not DIAGNOSTIC-0. Not WRIM-EVAL-S3-000001. Not used for training."
)

RETENTION_CATEGORIES = [
    "GENERAL_PROSE",
    "FACTUAL_CONTINUATION",
    "CODE",
    "STRUCTURED_OUTPUT",
    "INSTRUCTION_FOLLOWING",
    "LONG_FORM_CONTINUITY",
    "REPETITION_RESISTANCE",
    "SPECIAL_TOKEN_STABILITY",
]

STRUCT_CATEGORIES = [
    "JSON",
    "KEY_VALUE",
    "LIST",
    "CSV",
    "SCHEMA_ADHERENCE",
]


def _item(
    suite_id: str,
    item_id: str,
    category: str,
    prompt_text: str,
    *,
    max_new_tokens: int,
    scoring_functions: list[str],
    reference_payload: dict[str, Any] | None,
    notes: str,
) -> dict[str, Any]:
    return {
        "suite_id": suite_id,
        "suite_version": SUITE_VERSION,
        "item_id": item_id,
        "category": category,
        "prompt_text": prompt_text,
        "reference_type": "CONSTRAINT" if reference_payload else "NONE",
        "reference_payload": reference_payload,
        "generation_mode": "greedy_argmax",
        "max_new_tokens": max_new_tokens,
        "scoring_functions": scoring_functions,
        "hard_integrity_checks": ["finite_logits"],
        "notes": notes,
        "authorship": AUTHORSHIP,
        "created_at": CREATED_AT,
        "training_use": "FORBIDDEN",
        "evaluation_only": True,
    }


RETENTION_ITEMS: list[dict[str, Any]] = [
    _item(RETENTION_SUITE_ID, "ret-prose-01", "GENERAL_PROSE",
         "The mill-pond at Zevorra had iced at the edges, and a single reed stuck through the skin of ice. Lira kept her gloves in her pocket and watched the reed lean, then right itself. She told herself she would wait until the reed leaned once more before",
         max_new_tokens=32, scoring_functions=["greedy_32", "fingerprint", "entropy", "max_token_run"],
         reference_payload=None, notes="Invented mill-pond continuation."),
    _item(RETENTION_SUITE_ID, "ret-prose-02", "GENERAL_PROSE",
         '"Leave the spindle," said Orren, still marking the Ulnara night-ledger. "I did not bring a spindle," Tamsin said, and then, almost to the page,',
         max_new_tokens=32, scoring_functions=["greedy_32", "fingerprint", "entropy"],
         reference_payload=None, notes="Invented dialogue turn."),
    _item(RETENTION_SUITE_ID, "ret-prose-03", "GENERAL_PROSE",
         "On the Mirketh sill sat a cracked thimble, a coil of grey thread, and a chip of green glass. Dust had gathered in the thimble's seam. The glass chip, unlike the thread, did not",
         max_new_tokens=32, scoring_functions=["greedy_32", "fingerprint", "entropy", "max_token_run"],
         reference_payload=None, notes="Invented still life."),
    _item(RETENTION_SUITE_ID, "ret-fact-01", "FACTUAL_CONTINUATION",
         "In the Sablecroft primer, a sealed spool is labeled quiet when it holds no dye and is stored on its side. The primer then states that the first handling rule for a quiet spool is to",
         max_new_tokens=32, scoring_functions=["greedy_32", "fingerprint"],
         reference_payload=None, notes="Authored workshop definition."),
    _item(RETENTION_SUITE_ID, "ret-fact-02", "FACTUAL_CONTINUATION",
         "The Pellwick stencil tally uses a fixed rule: eight quiet spools fill one tray, and trays are counted only in whole numbers. If a clerk has twenty-four spools, the number of complete trays is",
         max_new_tokens=32, scoring_functions=["greedy_32", "constraint_substring_any", "fingerprint"],
         reference_payload={"expected_token_substrings": ["3", "three"], "arithmetic": "24/8=3"},
         notes="Local arithmetic in the prompt."),
    _item(RETENTION_SUITE_ID, "ret-fact-03", "FACTUAL_CONTINUATION",
         "To close the Mirketh spindle-house, the posted order is: bank the small kiln, latch the pond door, then hang the tin hook on the inner peg. After the kiln is banked, the next required action is to",
         max_new_tokens=32, scoring_functions=["greedy_32", "constraint_substring_any", "fingerprint"],
         reference_payload={"expected_token_substrings": ["latch", "pond door", "door"]},
         notes="Ordered process stated in the prompt."),
    _item(RETENTION_SUITE_ID, "ret-code-01", "CODE",
         "def tally_spindles(n):\n    # return n trays if n is a whole number of eights, else 0\n    ",
         max_new_tokens=32, scoring_functions=["greedy_32", "code_has_return", "no_tool_markup", "fingerprint"],
         reference_payload={"must_contain_any": ["return"], "forbid_substrings": ["TOOL=", "<|tool", "function_call"]},
         notes="Tiny Python body. Unique function name."),
    _item(RETENTION_SUITE_ID, "ret-code-02", "CODE",
         "pairs = [(2, 3), (4, 5), (8, 1)]\nclosed = [\n    x * y for (x, y) in pairs if x < 6\n",
         max_new_tokens=32, scoring_functions=["greedy_32", "code_closes_bracket", "no_tool_markup", "fingerprint"],
         reference_payload={"must_contain_any": ["]"], "forbid_substrings": ["```", "TOOL="]},
         notes="Close a truncated list comprehension."),
    _item(RETENTION_SUITE_ID, "ret-code-03", "CODE",
         "spindle_id = ",
         max_new_tokens=32, scoring_functions=["greedy_32", "no_tool_markup", "not_empty", "fingerprint"],
         reference_payload={"forbid_substrings": ["TOOL=", "<|tool", "function_call"]},
         notes="One-line assignment using bound vocab."),
    _item(RETENTION_SUITE_ID, "ret-struct-01", "STRUCTURED_OUTPUT",
         "Fill only this object shape and stop. Keys must be pond_id and reed_count. JSON=",
         max_new_tokens=32, scoring_functions=["greedy_32", "json_parse", "json_required_keys", "fingerprint"],
         reference_payload={"json_type": "object", "required_keys": ["pond_id", "reed_count"]},
         notes="Retention-set JSON object. Distinct from the expanded structured suite."),
    _item(RETENTION_SUITE_ID, "ret-struct-02", "STRUCTURED_OUTPUT",
         "Write two unlabeled assignments using equals, not JSON. pond_id =",
         max_new_tokens=32, scoring_functions=["greedy_32", "constraint_substring_any", "fingerprint"],
         reference_payload={"expected_token_substrings": ["="]},
         notes="Retention-set equals assignment, not the key: value suite."),
    _item(RETENTION_SUITE_ID, "ret-struct-03", "STRUCTURED_OUTPUT",
         "Give a two-field tally as pond_id then a space then reed_count, with no commas.\n",
         max_new_tokens=32, scoring_functions=["greedy_32", "not_empty", "fingerprint"],
         reference_payload=None,
         notes="Retention-set space-separated pair."),
    _item(RETENTION_SUITE_ID, "ret-inst-01", "INSTRUCTION_FOLLOWING",
         "Answer with a single English color word and then stop. The color of a clear noon sky is usually",
         max_new_tokens=32, scoring_functions=["greedy_32", "exactly_one_word", "accepted_word", "fingerprint"],
         reference_payload={"mode": "exactly_one_word", "accepted_words": ["blue", "Blue", "BLUE"]},
         notes="One-word color constraint. Not a compass item."),
    _item(RETENTION_SUITE_ID, "ret-inst-02", "INSTRUCTION_FOLLOWING",
         "Copy this mill stamp once, then halt: PELLWICK-TIN-STAMP",
         max_new_tokens=32, scoring_functions=["greedy_32", "contains_exact_span", "fingerprint"],
         reference_payload={"span": "PELLWICK-TIN-STAMP"},
         notes="Copy a unique stamp. Distinct marker from Stage3."),
    _item(RETENTION_SUITE_ID, "ret-inst-03", "INSTRUCTION_FOLLOWING",
         "Print these three mill notes separated by slashes only: quiet / sealed / upright",
         max_new_tokens=32, scoring_functions=["greedy_32", "contains_exact_span", "fingerprint"],
         reference_payload={"span": "quiet"},
         notes="Slash-separated tokens, not comma CSV."),
    _item(RETENTION_SUITE_ID, "ret-long-01", "LONG_FORM_CONTINUITY",
         "Keep telling the same mill-pond story without changing the place-name. Lira waited at Zevorra mill-pond after the reed froze in the ice. The reed kept leaning and righting. She counted the small cracks and decided that if a lamp appeared on the far bank she would",
         max_new_tokens=256, scoring_functions=["greedy_256", "fingerprint", "entropy", "max_token_run", "unique_ratio_256"],
         reference_payload={"track_entity": "Zevorra"},
         notes="256-token narrative continuity."),
    _item(RETENTION_SUITE_ID, "ret-long-02", "LONG_FORM_CONTINUITY",
         "Continue this spindle-house notice in plain sentences. The Sablecroft primer requires quiet spools to lie on their side. Eight spools fill one tray. Clerks must not unwind a sealed spool at the pond. The next paragraph of the notice explains why the spools stay sealed during",
         max_new_tokens=256, scoring_functions=["greedy_256", "fingerprint", "entropy", "max_token_run", "unique_ratio_256"],
         reference_payload=None, notes="256-token factual paragraph."),
    _item(RETENTION_SUITE_ID, "ret-long-03", "LONG_FORM_CONTINUITY",
         "Keep adding helper comments and tiny functions about quiet trays. Stay in Python source.\n\ndef tray_ok(n):\n    return n > 0\n\n# next helper should mention Mirketh\n",
         max_new_tokens=256, scoring_functions=["greedy_256", "no_tool_markup", "fingerprint", "max_token_run"],
         reference_payload={"forbid_substrings": ["TOOL=", "<|tool"]},
         notes="256-token code-like continuation. Distinct function names from Stage3."),
    _item(RETENTION_SUITE_ID, "ret-rep-01", "REPETITION_RESISTANCE",
         "Describe the evening close of the Mirketh spindle-house as several different sentences. Mention the small kiln, the pond door, and the tin hook once each, then invent new duties. After the tin hook is hung, the clerk still has to",
         max_new_tokens=256, scoring_functions=["greedy_256", "fingerprint", "max_token_run", "unique_ratio_256", "entropy"],
         reference_payload=None, notes="Watch one-token loops. Distinct from Stage3 closing-order stem."),
    _item(RETENTION_SUITE_ID, "ret-rep-02", "REPETITION_RESISTANCE",
         "Name distinct mill tools in ordinary sentences without repeating the same tool word over and over. The first tool is a tin hook. The second is a grey thread. After those, the clerk should mention",
         max_new_tokens=256, scoring_functions=["greedy_256", "fingerprint", "max_token_run", "unique_ratio_256"],
         reference_payload=None, notes="Avoid copy-loop of a single noun."),
    _item(RETENTION_SUITE_ID, "ret-rep-03", "REPETITION_RESISTANCE",
         "Count upward in words from one to eight inside a short notice, then continue in new sentences about the Pellwick stencil. one two three",
         max_new_tokens=256, scoring_functions=["greedy_256", "fingerprint", "max_token_run", "unique_ratio_256"],
         reference_payload=None, notes="Avoid stalling on a single numeral."),
    _item(RETENTION_SUITE_ID, "ret-spec-01", "SPECIAL_TOKEN_STABILITY",
         "The tin hook hung from the inner peg and tapped the pond door once. In the morning someone would take it down and",
         max_new_tokens=256, scoring_functions=["greedy_256", "special_rate_0_8", "special_loop", "fingerprint"],
         reference_payload={"special_ids": [0, 1, 2, 3, 4, 5, 6, 7, 8]},
         notes="Ordinary prose special-token rate."),
    _item(RETENTION_SUITE_ID, "ret-spec-02", "SPECIAL_TOKEN_STABILITY",
         "Mention a mill stamp that uses parentheses (like this) and a question at the end of a plain sentence about Ulnara.",
         max_new_tokens=256, scoring_functions=["greedy_256", "special_rate_0_8", "special_loop", "fingerprint"],
         reference_payload={"special_ids": [0, 1, 2, 3, 4, 5, 6, 7, 8]},
         notes="Delimiter-ish stem without copying Stage3 punctuation prompt."),
    _item(RETENTION_SUITE_ID, "ret-spec-03", "SPECIAL_TOKEN_STABILITY",
         "End the mill notice after one short clause about the tin hook, then stop.",
         max_new_tokens=256, scoring_functions=["greedy_256", "special_rate_0_8", "fingerprint"],
         reference_payload={"special_ids": [0, 1, 2, 3, 4, 5, 6, 7, 8], "eos_ok_once": True},
         notes="EOS may appear as end, not as a run."),
]


STRUCT_ITEMS: list[dict[str, Any]] = [
    _item(STRUCT_SUITE_ID, "struct-json-01", "JSON",
         "Emit one object. Required names: mill_id (text) and spool_count (number). Begin now: {",
         max_new_tokens=32, scoring_functions=["greedy_32", "json_parse", "json_required_keys", "fingerprint"],
         reference_payload={"json_type": "object", "required_keys": ["mill_id", "spool_count"]},
         notes="Object with two required keys. Wording distinct from Stage3 JSON stems."),
    _item(STRUCT_SUITE_ID, "struct-json-02", "JSON",
         "Emit a bracket list holding three mill-tool names as strings, then stop. Begin: [",
         max_new_tokens=32, scoring_functions=["greedy_32", "json_parse", "json_array_len_3", "fingerprint"],
         reference_payload={"json_type": "array", "min_len": 3, "max_len": 3, "element_type": "str"},
         notes="Array of three strings."),
    _item(STRUCT_SUITE_ID, "struct-json-03", "JSON",
         "Emit an object whose ready field is true or false and whose note field is null. Begin: {",
         max_new_tokens=32, scoring_functions=["greedy_32", "json_parse", "json_bool_null", "fingerprint"],
         reference_payload={"json_type": "object", "required_keys": ["ready", "note"], "ready_type": "bool", "note_is_null": True},
         notes="Boolean and null tokens."),
    _item(STRUCT_SUITE_ID, "struct-kv-01", "KEY_VALUE",
         "Write colon lines, not braces. Copy this pattern with any values:\nmill_id: Z1\nspool_count: 8\n",
         max_new_tokens=32, scoring_functions=["greedy_32", "key_value_lines", "fingerprint"],
         reference_payload={"required_keys": ["mill_id", "spool_count"]},
         notes="Two key: value lines."),
    _item(STRUCT_SUITE_ID, "struct-kv-02", "KEY_VALUE",
         "Finish a colon line and stop. Do not open a brace.\ntray_id:",
         max_new_tokens=32, scoring_functions=["greedy_32", "key_value_lines", "fingerprint"],
         reference_payload={"required_keys": ["tray_id"]},
         notes="Single key continuation."),
    _item(STRUCT_SUITE_ID, "struct-kv-03", "KEY_VALUE",
         "Colon format only. First line must start ready: and the value must be true or false.\nready:",
         max_new_tokens=32, scoring_functions=["greedy_32", "key_value_lines", "fingerprint"],
         reference_payload={"required_keys": ["ready"]},
         notes="Boolean-like key/value."),
    _item(STRUCT_SUITE_ID, "struct-list-01", "LIST",
         "Stack exactly three mill tools as separate lines, each starting with a dash.\n- ",
         max_new_tokens=32, scoring_functions=["greedy_32", "list_lines", "fingerprint"],
         reference_payload={"min_lines": 3},
         notes="Bullet-like list."),
    _item(STRUCT_SUITE_ID, "struct-list-02", "LIST",
         "Stack three quiet-spool steps as separate numbered lines.\n1. ",
         max_new_tokens=32, scoring_functions=["greedy_32", "list_lines", "fingerprint"],
         reference_payload={"min_lines": 3},
         notes="Numbered list."),
    _item(STRUCT_SUITE_ID, "struct-list-03", "LIST",
         "Add two more mill tools under this stack, one per line:\nhook\nthread\n",
         max_new_tokens=32, scoring_functions=["greedy_32", "list_lines", "fingerprint"],
         reference_payload={"min_lines": 2},
         notes="List continuation."),
    _item(STRUCT_SUITE_ID, "struct-csv-01", "CSV",
         "One comma-separated data row in order mill_id then spool_count then ready. No extra words.\n",
         max_new_tokens=32, scoring_functions=["greedy_32", "csv_row", "fingerprint"],
         reference_payload={"min_fields": 3},
         notes="One CSV row."),
    _item(STRUCT_SUITE_ID, "struct-csv-02", "CSV",
         "Finish this comma row and stop: Z1,8,",
         max_new_tokens=32, scoring_functions=["greedy_32", "csv_row", "fingerprint"],
         reference_payload={"min_fields": 1, "prefix": "Z1,8,"},
         notes="CSV prefix completion."),
    _item(STRUCT_SUITE_ID, "struct-csv-03", "CSV",
         "After this header print one matching data row:\nmill_id,spool_count\n",
         max_new_tokens=32, scoring_functions=["greedy_32", "csv_row", "fingerprint"],
         reference_payload={"min_fields": 2},
         notes="Header plus row."),
    _item(STRUCT_SUITE_ID, "struct-schema-01", "SCHEMA_ADHERENCE",
         "Satisfy types mill_id=text, spool_count=number, ready=true/false in one object. Begin: {",
         max_new_tokens=32, scoring_functions=["greedy_32", "json_parse", "schema_object", "fingerprint"],
         reference_payload={"required_keys": ["mill_id", "spool_count", "ready"], "ready_type": "bool", "spool_type": "number"},
         notes="Three-key schema."),
    _item(STRUCT_SUITE_ID, "struct-schema-02", "SCHEMA_ADHERENCE",
         "Nest a flag. Copy this skeleton if needed: {\"bin\":{\"inner_flag\":true}} then stop.\n",
         max_new_tokens=32, scoring_functions=["greedy_32", "json_parse", "json_nested_outer", "fingerprint"],
         reference_payload={"json_type": "object", "required_keys": ["bin"], "nested_key": "inner_flag"},
         notes="Nested schema. Uses bin not outer to avoid Stage3 nested stem."),
    _item(STRUCT_SUITE_ID, "struct-schema-03", "SCHEMA_ADHERENCE",
         "Repair this broken object and emit only the finished object: {\"mill_id\": \"Z1\", \"spool_count\":",
         max_new_tokens=32, scoring_functions=["greedy_32", "json_parse_prefix_repair", "json_required_keys", "fingerprint"],
         reference_payload={"json_type": "object", "required_keys": ["mill_id", "spool_count"]},
         notes="Prefix-repair schema."),
]


def assert_inventory() -> None:
    assert len(RETENTION_ITEMS) == 24
    assert len(STRUCT_ITEMS) == 15
    rids = [it["item_id"] for it in RETENTION_ITEMS]
    sids = [it["item_id"] for it in STRUCT_ITEMS]
    assert len(rids) == len(set(rids))
    assert len(sids) == len(set(sids))
    for cat in RETENTION_CATEGORIES:
        n = sum(1 for it in RETENTION_ITEMS if it["category"] == cat)
        assert n == 3, (cat, n)
    for cat in STRUCT_CATEGORIES:
        n = sum(1 for it in STRUCT_ITEMS if it["category"] == cat)
        assert n == 3, (cat, n)


def freeze_payload(suite_id: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    assert_inventory()
    return {
        "suite_id": suite_id,
        "suite_version": SUITE_VERSION,
        "created_at": CREATED_AT,
        "authorship": AUTHORSHIP,
        "evaluation_only": True,
        "training_use": "FORBIDDEN",
        "replaces_cap_eval_0": False,
        "n_items": len(items),
        "items": items,
    }
