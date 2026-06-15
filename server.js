// ─────────────────────────────────────────────────────────────────────────────
// AUTOPARTS HAÏTI — Serveur Backend
// Node.js + Express + PostgreSQL
// ─────────────────────────────────────────────────────────────────────────────

const express    = require("express");
const { Pool }   = require("pg");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const cors       = require("cors");

const app  = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "autoparts_haiti_secret_2024";

// ── Connexion base de données ─────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true,
}));
app.use(express.json());

// ── Middleware d'authentification ─────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ erreur: "Non autorisé" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erreur: "Token invalide" });
  }
}

function proprietaireOnly(req, res, next) {
  if (req.user.role !== "proprietaire")
    return res.status(403).json({ erreur: "Accès réservé au propriétaire" });
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES AUTH
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ erreur: "PIN requis" });
  try {
    const result = await pool.query("SELECT * FROM employes WHERE actif = true");
    let employe = null;
    for (const e of result.rows) {
      const ok = await bcrypt.compare(String(pin), e.pin_hash);
      if (ok) { employe = e; break; }
    }
    if (!employe) return res.status(401).json({ erreur: "Code PIN incorrect" });
    const token = jwt.sign(
      { id: employe.id, nom: employe.nom, role: employe.role },
      JWT_SECRET,
      { expiresIn: "12h" }
    );
    res.json({ token, employe: { id: employe.id, nom: employe.nom, role: employe.role } });
  } catch (e) {
    res.status(500).json({ erreur: "Erreur serveur", detail: e.message });
  }
});

// GET /api/auth/me
app.get("/api/auth/me", auth, (req, res) => res.json(req.user));

// ─────────────────────────────────────────────────────────────────────────────
// PIÈCES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/pieces
app.get("/api/pieces", auth, async (req, res) => {
  try {
    const { search, categorie, stock } = req.query;
    let q = `SELECT p.*, f.nom as fournisseur_nom, COALESCE(p.photos, '{}') as photos FROM pieces p
             LEFT JOIN fournisseurs f ON p.fournisseur_id = f.id WHERE 1=1`;
    const params = [];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      q += ` AND (LOWER(p.nom) LIKE $${params.length}
              OR LOWER(p.ref) LIKE $${params.length}
              OR LOWER(p.marque) LIKE $${params.length}
              OR LOWER(p.localisation) LIKE $${params.length}
              OR LOWER(array_to_string(p.vehicules, ' ')) LIKE $${params.length})`;
    }
    if (categorie && categorie !== "Toutes") {
      params.push(categorie);
      q += ` AND p.categorie = $${params.length}`;
    }
    if (stock === "Rupture") q += ` AND p.qte = 0`;
    if (stock === "Bas")     q += ` AND p.qte > 0 AND p.qte <= p.qte_min`;
    if (stock === "OK")      q += ` AND p.qte > p.qte_min`;

    q += ` ORDER BY p.nom`;
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ erreur: e.message });
  }
});

// POST /api/pieces
app.post("/api/pieces", auth, async (req, res) => {
  const { ref, nom, marque, categorie, qte, qte_min, prix_achat, prix_vente,
          localisation, vehicules, fournisseur_id } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO pieces (ref, nom, marque, categorie, qte, qte_min, prix_achat,
       prix_vente, localisation, vehicules, fournisseur_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [ref, nom, marque, categorie, qte, qte_min, prix_achat,
       prix_vente, localisation, vehicules, fournisseur_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ erreur: e.message });
  }
});

// PUT /api/pieces/:id
app.put("/api/pieces/:id", auth, async (req, res) => {
  const { ref, nom, marque, categorie, qte, qte_min, prix_achat, prix_vente,
          localisation, vehicules, fournisseur_id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE pieces SET ref=$1, nom=$2, marque=$3, categorie=$4, qte=$5,
       qte_min=$6, prix_achat=$7, prix_vente=$8, localisation=$9,
       vehicules=$10, fournisseur_id=$11, updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [ref, nom, marque, categorie, qte, qte_min, prix_achat,
       prix_vente, localisation, vehicules, fournisseur_id || null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ erreur: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// VENTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/ventes
app.get("/api/ventes", auth, async (req, res) => {
  try {
    const ventes = await pool.query(
      `SELECT v.*, e.nom as employe_nom FROM ventes v
       LEFT JOIN employes e ON v.employe_id = e.id
       ORDER BY v.created_at DESC LIMIT 200`
    );
    const lignes = await pool.query(
      `SELECT lv.*, p.nom as piece_nom, p.ref FROM lignes_vente lv
       LEFT JOIN pieces p ON lv.piece_id = p.id
       WHERE lv.vente_id = ANY($1)`,
      [ventes.rows.map(v => v.id)]
    );
    const result = ventes.rows.map(v => ({
      ...v,
      pieces: lignes.rows.filter(l => l.vente_id === v.id).map(l => ({
        ref: l.ref, nom: l.piece_nom, qty: l.qty, pu: l.prix_unitaire, total: l.total
      }))
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ erreur: e.message });
  }
});

// POST /api/ventes
app.post("/api/ventes", auth, async (req, res) => {
  const { client, telephone, vehicule, pieces, sous_total, recu, monnaie } = req.body;
  const client_db = await pool.connect();
  try {
    await client_db.query("BEGIN");

    const vente = await client_db.query(
      `INSERT INTO ventes (client, telephone, vehicule, sous_total, recu, monnaie, employe_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [client, telephone, vehicule, sous_total, recu, monnaie, req.user.id]
    );
    const venteId = vente.rows[0].id;

    for (const p of pieces) {
      const pieceRow = await client_db.query("SELECT id FROM pieces WHERE ref=$1", [p.ref]);
      if (!pieceRow.rows[0]) continue;
      const pieceId = pieceRow.rows[0].id;

      await client_db.query(
        `INSERT INTO lignes_vente (vente_id, piece_id, qty, prix_unitaire, total)
         VALUES ($1,$2,$3,$4,$5)`,
        [venteId, pieceId, p.qty, p.pu, p.total]
      );
      await client_db.query(
        `UPDATE pieces SET qte = qte - $1, vendu = vendu + $1, updated_at=NOW()
         WHERE id = $2`,
        [p.qty, pieceId]
      );
    }

    await client_db.query("COMMIT");
    res.status(201).json({ ...vente.rows[0], pieces });
  } catch (e) {
    await client_db.query("ROLLBACK");
    res.status(500).json({ erreur: e.message });
  } finally {
    client_db.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FOURNISSEURS
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/fournisseurs", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM fournisseurs ORDER BY nom");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ erreur: e.message }); }
});

app.post("/api/fournisseurs", auth, proprietaireOnly, async (req, res) => {
  const { nom, contact, telephone, whatsapp, email, adresse, devise, delai_livraison, note } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO fournisseurs (nom, contact, telephone, whatsapp, email, adresse, devise, delai_livraison, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [nom, contact, telephone, whatsapp, email, adresse, devise, delai_livraison, note]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ erreur: e.message }); }
});

app.put("/api/fournisseurs/:id", auth, proprietaireOnly, async (req, res) => {
  const { nom, contact, telephone, whatsapp, email, adresse, devise, delai_livraison, note } = req.body;
  try {
    const r = await pool.query(
      `UPDATE fournisseurs SET nom=$1, contact=$2, telephone=$3, whatsapp=$4,
       email=$5, adresse=$6, devise=$7, delai_livraison=$8, note=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [nom, contact, telephone, whatsapp, email, adresse, devise, delai_livraison, note, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ erreur: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// BONS DE COMMANDE
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/commandes", auth, proprietaireOnly, async (req, res) => {
  try {
    const commandes = await pool.query(
      `SELECT bc.*, f.nom as fournisseur_nom FROM bons_commande bc
       LEFT JOIN fournisseurs f ON bc.fournisseur_id = f.id
       ORDER BY bc.created_at DESC`
    );
    const lignes = await pool.query(
      `SELECT lbc.*, p.nom as piece_nom FROM lignes_bon_commande lbc
       LEFT JOIN pieces p ON lbc.piece_id = p.id
       WHERE lbc.bon_id = ANY($1)`,
      [commandes.rows.map(c => c.id)]
    );
    const result = commandes.rows.map(c => ({
      ...c,
      lignes: lignes.rows.filter(l => l.bon_id === c.id).map(l => ({
        ref: l.ref, nom: l.piece_nom, qty: l.qty, pu: l.prix_unitaire, total: l.total
      }))
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ erreur: e.message }); }
});

app.post("/api/commandes", auth, proprietaireOnly, async (req, res) => {
  const { fournisseur_id, lignes, total, note } = req.body;
  const client_db = await pool.connect();
  try {
    await client_db.query("BEGIN");
    const bc = await client_db.query(
      `INSERT INTO bons_commande (fournisseur_id, total, note, statut)
       VALUES ($1,$2,$3,'En attente') RETURNING *`,
      [fournisseur_id, total, note]
    );
    const bonId = bc.rows[0].id;
    for (const l of lignes) {
      const pieceRow = await client_db.query("SELECT id FROM pieces WHERE ref=$1", [l.ref]);
      const pieceId = pieceRow.rows[0]?.id;
      await client_db.query(
        `INSERT INTO lignes_bon_commande (bon_id, piece_id, ref, qty, prix_unitaire, total)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [bonId, pieceId, l.ref, l.qty, l.pu, l.total]
      );
    }
    await client_db.query("COMMIT");
    res.status(201).json(bc.rows[0]);
  } catch (e) {
    await client_db.query("ROLLBACK");
    res.status(500).json({ erreur: e.message });
  } finally {
    client_db.release();
  }
});

app.patch("/api/commandes/:id/statut", auth, proprietaireOnly, async (req, res) => {
  const { statut } = req.body;
  try {
    const r = await pool.query(
      "UPDATE bons_commande SET statut=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [statut, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ erreur: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DEMANDES CLIENTS
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/demandes", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM demandes ORDER BY created_at DESC");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ erreur: e.message }); }
});

app.post("/api/demandes", auth, async (req, res) => {
  const { piece, client, telephone } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO demandes (piece, client, telephone, statut)
       VALUES ($1,$2,$3,'En recherche') RETURNING *`,
      [piece, client, telephone]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ erreur: e.message }); }
});

app.patch("/api/demandes/:id/statut", auth, async (req, res) => {
  const { statut } = req.body;
  try {
    const r = await pool.query(
      "UPDATE demandes SET statut=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [statut, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ erreur: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYÉS
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/employes", auth, proprietaireOnly, async (req, res) => {
  try {
    const r = await pool.query("SELECT id, nom, role, actif FROM employes ORDER BY nom");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ erreur: e.message }); }
});

app.post("/api/employes", auth, proprietaireOnly, async (req, res) => {
  const { nom, pin, role } = req.body;
  try {
    const pin_hash = await bcrypt.hash(pin, 10);
    const r = await pool.query(
      "INSERT INTO employes (nom, pin_hash, role) VALUES ($1,$2,$3) RETURNING id, nom, role",
      [nom, pin_hash, role]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ erreur: e.message }); }
});

app.patch("/api/employes/:id/actif", auth, proprietaireOnly, async (req, res) => {
  const { actif } = req.body;
  try {
    const r = await pool.query(
      "UPDATE employes SET actif=$1 WHERE id=$2 RETURNING id, nom, role, actif",
      [actif, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ erreur: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// RAPPORTS
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/rapports/dashboard", auth, proprietaireOnly, async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const [ventesJour, totalStock, alertes, topPieces] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(sous_total),0) as total, COUNT(*) as nb FROM ventes WHERE DATE(created_at) = $1`, [today]),
      pool.query(`SELECT COALESCE(SUM(qte * prix_achat),0) as valeur, COUNT(*) as nb FROM pieces`),
      pool.query(`SELECT COUNT(*) as ruptures FROM pieces WHERE qte = 0`),
      pool.query(`SELECT nom, vendu FROM pieces ORDER BY vendu DESC LIMIT 5`),
    ]);
    res.json({
      ventesJour: ventesJour.rows[0],
      stock: totalStock.rows[0],
      alertes: alertes.rows[0],
      topPieces: topPieces.rows,
    });
  } catch (e) { res.status(500).json({ erreur: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TAUX DE CHANGE (proxy pour éviter CORS)
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/taux", async (req, res) => {
  try {
    const r = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    const d = await r.json();
    res.json({ taux: Math.round(d.rates?.HTG || 142), source: "exchangerate-api" });
  } catch {
    res.json({ taux: 142, source: "defaut" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connectée", timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: "erreur", db: e.message });
  }
});

app.listen(PORT, () => console.log(`✅ AutoParts API démarrée sur le port ${PORT}`));
