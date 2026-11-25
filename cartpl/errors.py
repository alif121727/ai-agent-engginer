"""Exception terdefinisi untuk cartpl.

Setiap exception membawa `code` yang dipetakan langsung ke exit code CLI,
sehingga `cli.py` tidak perlu tabel if/elif untuk menerjemahkan error.
"""
from __future__ import annotations


class CartplError(Exception):
    """Akar semua error cartpl. Default: internal error (5)."""

    code = 5

    def __init__(self, message: str, *, path: str | None = None, hint: str | None = None):
        super().__init__(message)
        self.message = message
        self.path = path
        self.hint = hint


class SchemaValidationError(CartplError):
    code = 1


class SemanticValidationError(CartplError):
    code = 1


class VariantForbiddenOverrideError(CartplError):
    code = 1


class PhysicsInconsistentError(CartplError):
    code = 1


class TemplateNotFoundError(CartplError):
    code = 4


class VariantNotFoundError(CartplError):
    code = 4


class PackNotFoundError(CartplError):
    code = 4


class TemplateCycleError(CartplError):
    code = 3


class NoMigrationPathError(CartplError):
    code = 3


class LockMismatchError(CartplError):
    code = 3


class ImportConflictError(CartplError):
    code = 3


class IOErrorCartpl(CartplError):
    """Error baca/tulis berkas. Tidak memakai nama `IOError` agar tidak
    menutupi builtin."""

    code = 2
