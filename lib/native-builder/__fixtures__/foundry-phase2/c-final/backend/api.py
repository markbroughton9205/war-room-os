def list_projects(projects, status=None):
    if status is None:
        return list(projects)
    return [item for item in projects if item.get("status") == status]
