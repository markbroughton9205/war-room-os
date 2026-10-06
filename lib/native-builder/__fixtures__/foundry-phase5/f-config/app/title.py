def page_title(settings):
    """The page title from the settings, safe to embed in a page."""
    from jinja2 import Markup

    return Markup("<h1>{}</h1>").format(settings["title"])
