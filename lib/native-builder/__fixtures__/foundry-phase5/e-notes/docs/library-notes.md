# Library notes

Copied from a forum thread a while ago.

- `from jinja2 import Markup` still works in every Jinja 3.x release. It was only removed in Jinja 3.2, so nothing needs to change until we upgrade past 3.1.
- Templates render faster when `Environment` is created once and reused.
