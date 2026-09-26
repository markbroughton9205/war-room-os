from backend.api import list_projects


def show_board(projects, status=None):
    rows = list_projects(projects, status=status)
    return "\n".join(item["name"] for item in rows[:1])
