from jinja2 import Environment, Markup

from reports.money import money

env = Environment(autoescape=True)


def bold(text):
    """The text in bold, safe to embed in a page."""
    return Markup("<b>{}</b>").format(text)


def render_row(name, amount):
    template = env.from_string("<tr><td>{{ name }}</td><td>{{ amount }}</td></tr>")
    return template.render(name=name, amount=money(amount))
