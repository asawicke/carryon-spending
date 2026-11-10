"""Persistent, Unicode-aware category names shared by expense entry and planning."""
import unicodedata
from .accounts import owner_key

BASE_CATEGORIES = ("Stay", "Transit", "Flights", "Food", "Activities", "Shopping", "Other")
PREPARATION = ("passport", "visa", "insurance", "sim", "fees", "baggage")


def clean_name(value):
    return " ".join(unicodedata.normalize("NFKC", value).split())


def canonical_category(db, name, scope=None, activate=True):
    name = clean_name(name)
    key = name.casefold()
    for standard in BASE_CATEGORIES:
        if standard.casefold() == key:
            return standard
    scope = scope or owner_key()
    row = db.execute("SELECT name FROM categories WHERE name_key=? AND owner_key=?", (key, scope)).fetchone()
    if row:
        if activate:
            db.execute("UPDATE categories SET active=1 WHERE owner_key=? AND name_key=?", (scope,key))
        return row["name"]
    db.execute("INSERT INTO categories (owner_key,name_key,name) VALUES (?,?,?) ON CONFLICT DO NOTHING", (scope,key,name))
    return db.execute("SELECT name FROM categories WHERE name_key=? AND owner_key=?", (key, scope)).fetchone()["name"]


def register_categories(app, helpers):
    db, body, text, error = (helpers[key] for key in ("get_db", "body_object", "text_field", "ApiError"))

    @app.get("/api/categories")
    def list_categories():
        custom = [row["name"] for row in db().execute("SELECT name FROM categories WHERE owner_key=? AND active=1 ORDER BY name_key", (owner_key(),))]
        return {"standard": list(BASE_CATEGORIES), "custom": custom}

    @app.post("/api/categories")
    def add_category():
        data = body()
        if set(data) != {"name"}:
            raise error("Provide one category name.")
        name = clean_name(text(data["name"], "Category name", maximum=40))
        if not name:
            raise error("Category name is required.")
        result = canonical_category(db(), name)
        db().execute("UPDATE categories SET active=1 WHERE owner_key=? AND name_key=?", (owner_key(),name.casefold()))
        db().commit()
        return {"name": result}, 201

    @app.delete("/api/categories/<path:name>")
    def remove_category(name):
        key = clean_name(name).casefold()
        if any(key == item.casefold() for item in BASE_CATEGORIES):
            raise error("Built-in categories cannot be removed.")
        changed = db().execute("UPDATE categories SET active=0 WHERE owner_key=? AND name_key=? AND active=1", (owner_key(),key)).rowcount
        db().commit()
        if not changed:
            raise error("Category not found.", 404)
        return "", 204
