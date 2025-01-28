# What is Alembic?

Alembic is a database migration tool used in Python projects that utilize SQLAlchemy. It helps manage changes to the database schema over time in a consistent and version-controlled manner. With Alembic, developers can track schema changes, apply them incrementally, and roll them back when necessary. It is especially useful in collaborative projects or when deploying applications across multiple environments, such as development, staging, and production.

Why Use Alembic?
Version Control for Schemas: Alembic enables tracking changes to the database schema, ensuring consistency across environments.
Incremental Schema Changes: Allows developers to apply changes in small, manageable steps instead of large, error-prone updates.
Rollback Support: Provides functionality to undo changes if a migration introduces errors.
Collaboration: Simplifies schema updates in teams by maintaining a clear history of changes.
Automation: Automates the process of generating migration scripts from SQLAlchemy models.
Alembic is an essential tool for any Python project that relies on SQLAlchemy for database interactions, providing a systematic approach to schema evolution.




## Alembic Workflow for Adding a Column to the Database

This guide outlines the steps for installing Alembic, configuring it, and using it to add a `phone_number` column to the `user` table in a PostgreSQL database.

---

## Step 1: Install Alembic

Ensure Alembic is installed in your project environment:
```bash
pip install alembic
```

---

## Step 2: Initialize Alembic

Set up Alembic in your project:
```bash
alembic init alembic
```

### What happens:
- A new directory called `alembic` is created.
- An `alembic.ini` configuration file is generated, where you'll set your database connection string.

---

## Step 3: Configure `alembic.ini`

Open the `alembic.ini` file and update the `sqlalchemy.url` to point to your database:

```ini
sqlalchemy.url = postgresql+psycopg2://postgres:secret@localhost:5432/vachan_db
```

---

## Step 4: Update `env.py`

Open `alembic/env.py` and set the `target_metadata` to your SQLAlchemy `Base` metadata:

```python
from database import Base  # Import your Base metadata from database.py

target_metadata = Base.metadata
```

---

## Step 5: Modify the User Model

Add the new `phone_number` column to the `User` model in `database.py`:

```python
class User(Base):
    __tablename__ = "user"
    ...
    phone_number = Column(String, nullable=True)
```

---

## Step 6: Generate a New Migration Script

Generate a migration script using Alembic:
```bash
alembic revision --autogenerate -m "Add phone_number column to user table"
```

### What happens:
- A new migration file is created in `alembic/versions/`.
- The file contains an `upgrade()` and `downgrade()` function.

---

## Step 7: Review the Migration Script

Locate the new migration file in `alembic/versions/` and verify its contents. It should look similar to this:

```python
from alembic import op
import sqlalchemy as sa

# Revision identifiers, used by Alembic.
revision = 'revision_id'  # Unique ID for this migration
down_revision = 'previous_revision_id'  # ID of the previous migration
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('user', sa.Column('phone_number', sa.String(), nullable=True))

def downgrade():
    op.drop_column('user', 'phone_number')
```

---

## Step 8: Apply the Migration

Run the migration to update the database schema:
```bash
alembic upgrade head
```

### What happens:
- Alembic executes the `upgrade()` function, adding the `phone_number` column to the `user` table.
- The current database state is updated in Alembic's version tracking table.

---

## Step 9: Update Data (Optional)

If you want to populate existing rows with a default value for `phone_number`, modify the migration script:

```python
def upgrade():
    op.add_column('user', sa.Column('phone_number', sa.String(), nullable=True))
    # Add a default dummy phone number for existing rows
    op.execute('UPDATE "user" SET phone_number = \'000-000-0000\'')

def downgrade():
    op.drop_column('user', 'phone_number')
```

Re-run the migration:
```bash
alembic upgrade head
```

---

## Step 10: Verify the Changes

Use a database client or script to verify that the `user` table now includes the `phone_number` column.

### Example using `psql`:
```sql
\d user;  -- Describe the table
SELECT * FROM user;  -- Check the data
```

---

## Step 11: Roll Back (If Needed)

To undo the migration (e.g., remove the `phone_number` column), use:
```bash
alembic downgrade -1
```

### What happens:
- Alembic runs the `downgrade()` function, dropping the `phone_number` column.

---

## Step 12: Final Notes

- **Check Current Version:**
  ```bash
  alembic current
  ```
- **List Migration History:**
  ```bash
  alembic history
  ```
- **Testing:** Always test migrations in a staging environment before applying them in production.

---

By following these steps, you can safely and systematically update your database schema with Alembic.


