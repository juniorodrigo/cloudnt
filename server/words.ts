/**
 * 256 words for the verification fingerprint. Two positions -> 65,536 pairs.
 *
 * Dictionary rules: no accents or ñ (read on consoles with foreign fonts and
 * encodings), no pairs that sound alike when dictated aloud, and concrete nouns
 * — the fingerprint is verified by looking at two screens and reading it out.
 */
export const WORDS: readonly string[] = [
  // arboles y plantas
  "pino", "roble", "cedro", "olmo", "sauce", "haya", "abeto", "nogal",
  "arce", "fresno", "ciruelo", "manzano", "cerezo", "almendro", "avellano", "higuera",
  "helecho", "musgo", "junco", "trigo", "avena", "cebada", "menta", "salvia",
  "romero", "laurel", "tomillo", "cactus", "palma", "hiedra", "enebro", "mirto",
  // flores y frutos
  "dalia", "violeta", "amapola", "girasol", "cardo", "ortiga", "loto", "lirio",
  "rosa", "magnolia", "gardenia", "azucena", "clavel", "petunia", "begonia", "hortensia",
  "mango", "guayaba", "papaya", "mora", "fresa", "uva", "naranja", "pera",
  "membrillo", "durazno", "coco", "nuez", "grano", "semilla", "tallo", "hoja",
  // metales y minerales
  "cobre", "hierro", "acero", "plomo", "zinc", "bronce", "platino", "cromo",
  "oro", "plata", "granito", "cuarzo", "jade", "coral", "perla", "topacio",
  "yeso", "cal", "barro", "arcilla", "vidrio", "cristal", "resina", "cera",
  "grafito", "azufre", "sal", "pizarra", "basalto", "piedra", "guijarro", "canto",
  // clima y cielo
  "hielo", "nieve", "lluvia", "niebla", "nube", "viento", "brisa", "trueno",
  "rayo", "chispa", "llama", "brasa", "humo", "vapor", "escarcha", "granizo",
  "aurora", "alba", "ocaso", "cenit", "estrella", "cometa", "luna", "sol",
  "eclipse", "galaxia", "nebulosa", "meteoro", "planeta", "cosmos", "orbe", "cielo",
  // geografia
  "norte", "sur", "este", "oeste", "monte", "cerro", "valle", "risco",
  "cima", "ladera", "meseta", "llano", "pampa", "selva", "bosque", "prado",
  "campo", "huerto", "sendero", "camino", "duna", "playa", "costa", "isla",
  "cabo", "golfo", "arena", "roca", "cueva", "grieta", "cauce", "delta",
  // agua y navegacion
  "puente", "muro", "torre", "faro", "puerto", "muelle", "ancla", "vela",
  "remo", "quilla", "proa", "popa", "boya", "red", "nudo", "cuerda",
  "cable", "cadena", "balsa", "canoa", "barca", "marea", "ola", "espuma",
  "corriente", "remolino", "arroyo", "caudal", "lago", "laguna", "pozo", "fuente",
  // animales
  "lobo", "zorro", "oso", "ciervo", "liebre", "topo", "nutria", "castor",
  "lince", "gamo", "bisonte", "alce", "foca", "morsa", "ballena", "orca",
  "pulpo", "calamar", "erizo", "cangrejo", "trucha", "carpa", "anguila", "gaviota",
  "garza", "grulla", "milano", "cuervo", "mirlo", "jilguero", "alondra", "lechuza",
  // objetos y oficios
  "clavo", "tornillo", "llave", "cerrojo", "bisagra", "palanca", "rueda", "eje",
  "resorte", "martillo", "sierra", "lima", "cincel", "pinza", "aguja", "hilo",
  "tela", "seda", "lana", "cuero", "madera", "corcho", "caucho", "fibra",
  "regla", "mapa", "tinta", "pluma", "lienzo", "marco", "forja", "yunque",
];
