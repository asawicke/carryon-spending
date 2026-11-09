"""Persistent, Unicode-aware category names shared by expense entry and planning."""
import unicodedata

BASE_CATEGORIES = ("Stay", "Transit", "Flights", "Food", "Activities", "Shopping", "Other")
PREPARATION = ("passport", "visa", "insurance", "sim", "fees", "baggage")


def clean_name(value):
    return " ".join(unicodedata.normalize("NFKC", value).split())


def canonical_category(db, name):
    name = clean_name(name)
    key = name.casefold()
    for standard in BASE_CATEGORIES:
        if standard.casefold() == key:
            return standard
    row = db.execute("SELECT name FROM categories WHERE name_key=?", (key,)).fetchone()
    if row:
        return row["name"]
    db.execute("INSERT OR IGNORE INTO categories (name_key, name) VALUES (?,?)", (key, name))
    return db.execute("SELECT name FROM categories WHERE name_key=?", (key,)).fetchone()["name"]


def register_categories(app, helpers):
    db, body, text, error = (helpers[key] for key in ("get_db", "body_object", "text_field", "ApiError"))

    @app.get("/api/categories")
    def list_categories():
        custom = [row["name"] for row in db().execute("SELECT name FROM categories ORDER BY name_key")]
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
        db().commit()
        return {"name": result}, 201
