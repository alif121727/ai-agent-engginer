"""cartpl — Car Template System.

Template mobil prosedural untuk pipeline render 3D Python + ffmpeg.
Geometri, material, aksesori, dan respons permukaan hidup di JSON,
bukan di kode.
"""
__version__ = "1.0.0"

from .builder import Mesh, build_car  # noqa: E402
from .loader import list_templates, load_raw, resolve  # noqa: E402
from .validator import validate_semantics  # noqa: E402

__all__ = [
    "__version__",
    "build_car",
    "Mesh",
    "resolve",
    "load_raw",
    "list_templates",
    "validate_semantics",
]
