-- ─────────────────────────────────────────────────────────────────────────────
-- AUTOPARTS HAÏTI — Structure de la base de données PostgreSQL
-- À exécuter UNE SEULE FOIS sur Railway après création de la DB
-- ─────────────────────────────────────────────────────────────────────────────

-- ── EMPLOYÉS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employes (
  id         SERIAL PRIMARY KEY,
  nom        VARCHAR(100) NOT NULL,
  pin_hash   VARCHAR(255) NOT NULL,
  role       VARCHAR(20)  NOT NULL DEFAULT 'employe' CHECK (role IN ('proprietaire','employe')),
  actif      BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ── FOURNISSEURS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fournisseurs (
  id              SERIAL PRIMARY KEY,
  nom             VARCHAR(150) NOT NULL,
  contact         VARCHAR(100),
  telephone       VARCHAR(30),
  whatsapp        VARCHAR(30),
  email           VARCHAR(100),
  adresse         TEXT,
  devise          VARCHAR(5)  DEFAULT 'USD',
  delai_livraison VARCHAR(50),
  note            TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── PIÈCES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pieces (
  id             SERIAL PRIMARY KEY,
  ref            VARCHAR(50)  NOT NULL UNIQUE,
  nom            VARCHAR(200) NOT NULL,
  marque         VARCHAR(100),
  categorie      VARCHAR(50),
  qte            INTEGER      NOT NULL DEFAULT 0,
  qte_min        INTEGER      NOT NULL DEFAULT 0,
  prix_achat     NUMERIC(12,2) NOT NULL DEFAULT 0,
  prix_vente     NUMERIC(12,2) NOT NULL DEFAULT 0,
  localisation   VARCHAR(30),
  vehicules      TEXT[]       DEFAULT '{}',
  vendu          INTEGER      NOT NULL DEFAULT 0,
  fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pieces_ref        ON pieces(ref);
CREATE INDEX IF NOT EXISTS idx_pieces_categorie  ON pieces(categorie);
CREATE INDEX IF NOT EXISTS idx_pieces_qte        ON pieces(qte);

-- ── VENTES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ventes (
  id          SERIAL PRIMARY KEY,
  client      VARCHAR(150) NOT NULL DEFAULT 'Client anonyme',
  telephone   VARCHAR(30),
  vehicule    VARCHAR(150),
  sous_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  recu        NUMERIC(12,2) NOT NULL DEFAULT 0,
  monnaie     NUMERIC(12,2) NOT NULL DEFAULT 0,
  employe_id  INTEGER REFERENCES employes(id) ON DELETE SET NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ventes_date ON ventes(created_at);

-- ── LIGNES DE VENTE ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lignes_vente (
  id             SERIAL PRIMARY KEY,
  vente_id       INTEGER NOT NULL REFERENCES ventes(id) ON DELETE CASCADE,
  piece_id       INTEGER REFERENCES pieces(id) ON DELETE SET NULL,
  qty            INTEGER       NOT NULL,
  prix_unitaire  NUMERIC(12,2) NOT NULL,
  total          NUMERIC(12,2) NOT NULL
);

-- ── DEMANDES CLIENTS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demandes (
  id         SERIAL PRIMARY KEY,
  piece      TEXT         NOT NULL,
  client     VARCHAR(150),
  telephone  VARCHAR(30),
  statut     VARCHAR(30)  NOT NULL DEFAULT 'En recherche'
             CHECK (statut IN ('En recherche','Commandée','Disponible','Livrée')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── BONS DE COMMANDE ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bons_commande (
  id             SERIAL PRIMARY KEY,
  fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
  statut         VARCHAR(20) NOT NULL DEFAULT 'En attente'
                 CHECK (statut IN ('En attente','Confirmée','Livrée','Annulée')),
  total          NUMERIC(12,2) NOT NULL DEFAULT 0,
  note           TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── LIGNES BON DE COMMANDE ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lignes_bon_commande (
  id             SERIAL PRIMARY KEY,
  bon_id         INTEGER NOT NULL REFERENCES bons_commande(id) ON DELETE CASCADE,
  piece_id       INTEGER REFERENCES pieces(id) ON DELETE SET NULL,
  ref            VARCHAR(50),
  qty            INTEGER       NOT NULL,
  prix_unitaire  NUMERIC(12,2) NOT NULL,
  total          NUMERIC(12,2) NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- DONNÉES INITIALES
-- ─────────────────────────────────────────────────────────────────────────────

-- Propriétaire par défaut (PIN: 1234)
-- Le hash bcrypt de "1234" est généré avec 10 rounds
INSERT INTO employes (nom, pin_hash, role) VALUES
  ('Propriétaire', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'proprietaire')
ON CONFLICT DO NOTHING;

-- Note: Le hash ci-dessus correspond au PIN "1234"
-- Pour changer le PIN, utilise le module Employés dans l'application
-- ou génère un nouveau hash avec: node -e "const b=require('bcryptjs');console.log(b.hashSync('TONPIN',10))"

-- Fournisseurs de démonstration
INSERT INTO fournisseurs (nom, contact, telephone, whatsapp, email, adresse, devise, delai_livraison, note) VALUES
  ('Import Auto S.A.', 'Jean-Baptiste Moreau', '2290-1122', '50922901122', 'import.auto@gmail.com', 'Rue du Commerce, PAP', 'USD', '7-14 jours', 'Spécialiste filtres et consommables'),
  ('Caribbean Parts', 'Sandra Fils-Aimé', '3388-4455', '50933884455', 'caribbean.parts@yahoo.com', 'Pétion-Ville', 'USD', '3-7 jours', 'Pièces électriques et freinage'),
  ('ProMeca Haïti', 'Réginald Duval', '4410-7788', '50944107788', 'promeca.ht@gmail.com', 'Delmas 33', 'HTG', '1-3 jours', 'Suspension et transmission locale')
ON CONFLICT DO NOTHING;

-- Pièces de démonstration
INSERT INTO pieces (ref, nom, marque, categorie, qte, qte_min, prix_achat, prix_vente, localisation, vehicules, vendu, fournisseur_id) VALUES
  ('FH-4521','Filtre à huile','Bosch','Filtration',14,5,350,600,'A-01-2-B','{"Toyota Corolla 2010-2018","Toyota Camry 2012-2020"}',47,1),
  ('PF-8832','Plaquettes de frein avant','Brembo','Freinage',3,4,1200,2000,'B-02-1-A','{"Honda Civic 2006-2015","Honda Accord 2008-2017"}',31,2),
  ('FA-1190','Filtre à air','Mann','Filtration',8,3,280,480,'A-01-3-C','{"Nissan Almera 2000-2012","Nissan Tiida 2004-2013"}',28,1),
  ('AM-3301','Amortisseur avant droit','Monroe','Suspension',2,2,3500,5800,'C-04-1-A','{"Mitsubishi Lancer 2003-2015"}',12,3),
  ('BT-7710','Batterie 60Ah','Energizer','Électrique',6,3,4500,7200,'D-01-1-B','{"Universel"}',19,2),
  ('CL-2245','Kit d''embrayage','Valeo','Transmission',1,2,6800,10500,'C-03-2-A','{"Peugeot 206 2000-2012","Peugeot 307 2001-2008"}',8,3),
  ('EC-5502','Bougie d''allumage','NGK','Allumage',22,10,180,320,'A-03-1-D','{"Universel 4 cylindres"}',63,1),
  ('RP-9901','Rotule de direction','TRW','Direction',0,2,950,1600,'B-04-2-C','{"Kia Rio 2005-2017","Hyundai Accent 2006-2017"}',15,2)
ON CONFLICT (ref) DO NOTHING;
