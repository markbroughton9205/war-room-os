"""Frozen-probe helpers for WR-TOOL RED-X. No WRIM gradients. No LoRA."""
from __future__ import annotations

import math
from typing import Any

import numpy as np

from exp004_support import CLASS_NAMES, CLASS_TO_ID, N_CLASSES, classification_report_6

RNG = np.random.default_rng(0)

LAYER_IDS = ["tok_emb"] + [f"layers.{i}" for i in range(18)] + ["norm_f"]
POOL_IDS = (
    "assistant_boundary_last_token",
    "mean",
    "masked_mean",
    "max",
    "first_token",
)
MULTI_IDS = (
    "mean_final_2_last_token",
    "mean_final_4_last_token",
    "concat_final_4_last_token",
    "concat_span_last_token",
    "layer_averaged_mean_pool",
)

# Shadow analysis cards. Existing TOOL_REGISTRY + catalog metadata only.
# SHA256 is gym catalog, not TOOL_REGISTRY. NO_TOOL is not a registry tool.
REGISTRY_CARDS = [
    {
        "tool_id": "web",
        "class_name": "WEB",
        "name": "Web",
        "aliases": ["web", "browse", "lookup page", "http", "https"],
        "description": "External web lookup and page retrieval foundation.",
        "schema": "query:string required",
        "capability_category": "EXTERNAL_RETRIEVAL",
        "authority": "war_room_tool_registry",
        "distractor": False,
    },
    {
        "tool_id": "memory",
        "class_name": "MEMORY",
        "name": "Memory",
        "aliases": ["memory", "recall", "previously stored", "decree"],
        "description": "Session and long-term memory retrieval foundation.",
        "schema": "query:string required",
        "capability_category": "STATE_OR_ARTIFACT",
        "authority": "war_room_tool_registry",
        "distractor": False,
    },
    {
        "tool_id": "files",
        "class_name": "FILES",
        "name": "Files",
        "aliases": ["files", "document", "path", "workspace file"],
        "description": "Workspace file inspection and artifact handling foundation.",
        "schema": "path:string required",
        "capability_category": "STATE_OR_ARTIFACT",
        "authority": "war_room_tool_registry",
        "distractor": False,
    },
    {
        "tool_id": "research",
        "class_name": "RESEARCH",
        "name": "Research",
        "aliases": ["research", "multi-source", "synthesis", "investigate"],
        "description": "Multi-source research synthesis foundation.",
        "schema": "query:string required",
        "capability_category": "EXTERNAL_RETRIEVAL",
        "authority": "war_room_tool_registry",
        "distractor": False,
    },
    {
        "tool_id": "sha256",
        "class_name": "SHA256",
        "name": "Bounded SHA-256",
        "aliases": ["sha256", "sha-256", "digest", "hash"],
        "description": "Bounded SHA-256 hash utility. Deterministic digest of text. Not web retrieval.",
        "schema": "text:string required",
        "capability_category": "DETERMINISTIC_UTILITY",
        "authority": "agi_gym_bounded",
        "distractor": False,
    },
    {
        "tool_id": "none",
        "class_name": "NO_TOOL",
        "name": "No tool",
        "aliases": ["none", "no tool", "answer directly"],
        "description": "No external tool. Answer from general knowledge. Do not retrieve web, files, memory, or compute hashes.",
        "schema": "",
        "capability_category": "INTERNAL",
        "authority": "shadow_analysis_only",
        "distractor": False,
    },
    {
        "tool_id": "repo",
        "class_name": None,
        "name": "Repo",
        "aliases": ["repo", "git", "diff", "commit"],
        "description": "Repository status, diffs, patches, and commit workflow foundation.",
        "schema": "action:string required",
        "capability_category": "STATE_OR_ARTIFACT",
        "authority": "war_room_tool_registry",
        "distractor": True,
    },
    {
        "tool_id": "deployments",
        "class_name": None,
        "name": "Deployments",
        "aliases": ["deploy", "release"],
        "description": "Deployment status and release workflow foundation.",
        "schema": "action:string required",
        "capability_category": "STATE_OR_ARTIFACT",
        "authority": "war_room_tool_registry",
        "distractor": True,
    },
    {
        "tool_id": "build",
        "class_name": None,
        "name": "Build",
        "aliases": ["build request", "draft build"],
        "description": "Build request queue persistence and drafting.",
        "schema": "title:string required",
        "capability_category": "STATE_OR_ARTIFACT",
        "authority": "war_room_tool_registry",
        "distractor": True,
    },
    {
        "tool_id": "lookup_note",
        "class_name": None,
        "name": "Curriculum note lookup (synthetic)",
        "aliases": ["lookup_note", "note_id"],
        "description": "Curriculum note lookup (synthetic). Not an operator classroom class.",
        "schema": "note_id:string required",
        "capability_category": "DETERMINISTIC_UTILITY",
        "authority": "curriculum_synthetic",
        "distractor": True,
    },
]

COARSE = {
    "NO_TOOL": "INTERNAL",
    "WEB": "EXTERNAL_RETRIEVAL",
    "RESEARCH": "EXTERNAL_RETRIEVAL",
    "MEMORY": "STATE_OR_ARTIFACT",
    "FILES": "STATE_OR_ARTIFACT",
    "SHA256": "DETERMINISTIC_UTILITY",
}
COARSE_NAMES = ("INTERNAL", "EXTERNAL_RETRIEVAL", "STATE_OR_ARTIFACT", "DETERMINISTIC_UTILITY")
TOOL5 = ("WEB", "MEMORY", "FILES", "RESEARCH", "SHA256")
EXP005_TEST_BAL = 0.5386
BOW_TEST = {"accuracy": 0.9583333333333334, "balanced_accuracy": 0.9444444444444445, "macro_f1": 0.9568764568764568}


def jsonable(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.floating, float)):
        x = float(obj)
        if math.isnan(x) or math.isinf(x):
            return None
        return x
    if isinstance(obj, (np.integer, int)):
        return int(obj)
    if obj is None:
        return None
    return obj


def l2_normalize(x: np.ndarray, axis: int = -1, eps: float = 1e-12) -> np.ndarray:
    n = np.linalg.norm(x, axis=axis, keepdims=True)
    return x / np.maximum(n, eps)


def pairwise_cosine_stats(x: np.ndarray) -> dict[str, float]:
    n = x.shape[0]
    if n < 2:
        return {"mean": None, "median": None, "n_pairs": 0}
    xn = l2_normalize(x)
    g = xn @ xn.T
    iu = np.triu_indices(n, k=1)
    vals = g[iu]
    return {
        "mean": float(np.mean(vals)),
        "median": float(np.median(vals)),
        "n_pairs": int(vals.size),
    }


def class_cosine_stats(x: np.ndarray, y: np.ndarray) -> dict[str, Any]:
    xn = l2_normalize(x)
    within = []
    between = []
    centroids = {}
    disp = {}
    for c, name in enumerate(CLASS_NAMES):
        xc = xn[y == c]
        centroids[name] = xc.mean(0) if len(xc) else np.zeros(x.shape[1])
        if len(xc) >= 2:
            g = xc @ xc.T
            iu = np.triu_indices(len(xc), k=1)
            within.extend(g[iu].tolist())
            disp[name] = float(np.mean(np.linalg.norm(xc - centroids[name], axis=1)))
        else:
            disp[name] = 0.0 if len(xc) else None
    names = list(CLASS_NAMES)
    cents = np.stack([centroids[n] for n in names])
    cents = l2_normalize(cents)
    cd = {}
    for i, a in enumerate(names):
        for j, b in enumerate(names):
            if i < j:
                sim = float(cents[i] @ cents[j])
                between.append(sim)
                cd[f"{a}__{b}"] = {"cosine": sim, "l2": float(np.linalg.norm(cents[i] - cents[j]))}
    return {
        "within_class_cosine_mean": float(np.mean(within)) if within else None,
        "between_class_cosine_mean": float(np.mean(between)) if between else None,
        "centroid_pairwise": cd,
        "per_class_centroid_dispersion": disp,
    }


def eigenspectrum(x: np.ndarray) -> dict[str, Any]:
    xc = x - x.mean(0, keepdims=True)
    n, d = xc.shape
    if n < 2:
        return {"dimension": int(d), "effective_rank": None}
    cov = (xc.T @ xc) / max(n - 1, 1)
    eig = np.linalg.eigvalsh(cov)
    eig = np.clip(eig[::-1], 0, None)
    s = float(eig.sum()) + 1e-18
    p = eig / s
    pr = float((s * s) / (float(np.sum(eig * eig)) + 1e-18))
    ppos = p[p > 0]
    erank = float(np.exp(-np.sum(ppos * np.log(ppos))))
    k_list = [1, 2, 4, 8, 16, 32, 64, 128]
    ve = {str(k): float(p[: min(k, len(p))].sum()) for k in k_list if k <= d}
    return {
        "dimension": int(d),
        "n": int(n),
        "effective_rank": erank,
        "participation_ratio": pr,
        "participation_ratio_over_dim": pr / d,
        "top1_variance_explained": float(p[0]),
        "top_eigenvalue": float(eig[0]),
        "variance_explained_by_top_pcs": ve,
        "anisotropy_top1_share": float(p[0]),
        "eigenvalues_head": [float(v) for v in eig[:16]],
    }


def fisher_score(x: np.ndarray, y: np.ndarray) -> float:
    overall = x.mean(0)
    sw = 0.0
    sb = 0.0
    for c in range(N_CLASSES):
        xc = x[y == c]
        if not len(xc):
            continue
        mu = xc.mean(0)
        sw += float(((xc - mu) ** 2).sum())
        sb += float(len(xc) * ((mu - overall) ** 2).sum())
    return float(sb / max(sw, 1e-12))


def nn_purity(x: np.ndarray, y: np.ndarray) -> float:
    xn = l2_normalize(x)
    g = xn @ xn.T
    np.fill_diagonal(g, -np.inf)
    nn = g.argmax(1)
    return float(np.mean(y[nn] == y))


def geometry_bundle(x: np.ndarray, y: np.ndarray) -> dict[str, Any]:
    spec = eigenspectrum(x)
    pair = pairwise_cosine_stats(x)
    cls = class_cosine_stats(x, y)
    sil = None
    try:
        from sklearn.metrics import silhouette_score

        if len(np.unique(y)) >= 2 and x.shape[0] > len(np.unique(y)):
            sil = float(silhouette_score(x, y, metric="cosine"))
    except Exception:
        sil = None
    return {
        **spec,
        "mean_pairwise_cosine": pair["mean"],
        "median_pairwise_cosine": pair["median"],
        **cls,
        "fisher_separation": fisher_score(x, y),
        "silhouette_cosine": sil,
        "nearest_neighbor_class_purity": nn_purity(x, y),
        "measurable_anisotropy": bool(
            (spec.get("top1_variance_explained") is not None and spec["top1_variance_explained"] >= 0.20)
            or (pair["mean"] is not None and pair["mean"] >= 0.30)
        ),
    }


def apply_transform(name: str, xtr: np.ndarray, xva: np.ndarray, xte: np.ndarray):
    if name == "raw":
        return xtr, xva, xte, {"kind": "raw"}
    if name == "centered":
        mu = xtr.mean(0, keepdims=True)
        return xtr - mu, xva - mu, xte - mu, {"kind": "centered"}
    if name == "l2":
        return l2_normalize(xtr), l2_normalize(xva), l2_normalize(xte), {"kind": "l2"}
    if name == "standardized":
        mu = xtr.mean(0, keepdims=True)
        sd = xtr.std(0, keepdims=True) + 1e-8
        return (xtr - mu) / sd, (xva - mu) / sd, (xte - mu) / sd, {"kind": "standardized"}
    if name.startswith("pca") or name.startswith("whiten"):
        from sklearn.decomposition import PCA

        whiten = name.startswith("whiten")
        dim = int(name.split("_")[-1])
        dim = min(dim, xtr.shape[0] - 1, xtr.shape[1])
        pca = PCA(n_components=dim, whiten=whiten, random_state=0)
        return pca.fit_transform(xtr), pca.transform(xva), pca.transform(xte), {
            "kind": name,
            "n_components": dim,
            "whiten": whiten,
        }
    raise ValueError(name)


def fit_predict(kind: str, xtr, ytr, xte):
    from sklearn.linear_model import LogisticRegression
    from sklearn.neighbors import KNeighborsClassifier, NearestCentroid
    from sklearn.neural_network import MLPClassifier
    from sklearn.svm import LinearSVC, SVC

    if kind == "l2_logistic":
        m = LogisticRegression(C=1.0, penalty="l2", solver="lbfgs", max_iter=800, random_state=0)
        m.fit(xtr, ytr)
        pred = m.predict(xte)
        proba = m.predict_proba(xte) if hasattr(m, "predict_proba") else None
        return pred, proba, m
    if kind == "linear_svm":
        m = LinearSVC(C=1.0, max_iter=4000, random_state=0)
        m.fit(xtr, ytr)
        return m.predict(xte), None, m
    if kind == "rbf_svm":
        m = SVC(kernel="rbf", C=1.0, gamma="scale", random_state=0)
        m.fit(xtr, ytr)
        return m.predict(xte), None, m
    if kind == "knn_3":
        m = KNeighborsClassifier(n_neighbors=3)
        m.fit(xtr, ytr)
        return m.predict(xte), None, m
    if kind == "knn_5":
        k = 5 if len(xtr) >= 5 else max(1, len(xtr))
        m = KNeighborsClassifier(n_neighbors=k)
        m.fit(xtr, ytr)
        return m.predict(xte), None, m
    if kind == "centroid_euclidean":
        m = NearestCentroid(metric="euclidean")
        m.fit(xtr, ytr)
        return m.predict(xte), None, m
    if kind == "centroid_cosine":
        m = NearestCentroid(metric="euclidean")
        m.fit(l2_normalize(xtr), ytr)
        return m.predict(l2_normalize(xte)), None, m
    if kind == "mlp_64":
        m = MLPClassifier(
            hidden_layer_sizes=(64,),
            alpha=0.1,
            max_iter=400,
            early_stopping=True,
            validation_fraction=0.2,
            random_state=0,
        )
        m.fit(xtr, ytr)
        pred = m.predict(xte)
        proba = m.predict_proba(xte) if hasattr(m, "predict_proba") else None
        return pred, proba, m
    raise ValueError(kind)


LINEAR_PROBES = ("l2_logistic", "linear_svm", "centroid_euclidean", "centroid_cosine")
NONLINEAR_PROBES = ("rbf_svm", "knn_3", "knn_5", "mlp_64")
ALL_PROBES = LINEAR_PROBES + NONLINEAR_PROBES


def report(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
    return classification_report_6(y_true, y_pred)


def binary_report(y_true: np.ndarray, y_pred: np.ndarray, pos_name: str = "POS") -> dict[str, Any]:
    acc = float(np.mean(y_true == y_pred)) if len(y_true) else 0.0
    recs = []
    for c in (0, 1):
        m = y_true == c
        recs.append(float(np.mean(y_pred[m] == c)) if np.any(m) else 0.0)
    tp = int(np.sum((y_true == 1) & (y_pred == 1)))
    fp = int(np.sum((y_true == 0) & (y_pred == 1)))
    fn = int(np.sum((y_true == 1) & (y_pred == 0)))
    prec = tp / max(tp + fp, 1)
    rec = tp / max(tp + fn, 1)
    f1 = 2 * prec * rec / max(prec + rec, 1e-12)
    return {
        "accuracy": acc,
        "balanced_accuracy": float(np.mean(recs)),
        "precision_pos": prec,
        "recall_pos": rec,
        "f1_pos": f1,
        "n": int(len(y_true)),
        "positive_class": pos_name,
    }


def subset_mask(rows: list[dict[str, Any]], a: str, b: str) -> np.ndarray:
    return np.array([r["gold_class"] in (a, b) for r in rows], dtype=bool)


def card_text(card: dict[str, Any]) -> str:
    aliases = " ".join(card.get("aliases") or [])
    return " ".join(
        [
            card["name"],
            card["tool_id"],
            aliases,
            card.get("description") or "",
            card.get("schema") or "",
            card.get("capability_category") or "",
        ]
    ).strip()


def tokenize(s: str) -> list[str]:
    import re

    return re.findall(r"[a-z0-9_]+", s.casefold())


def bow_v5_style(train: list[dict[str, Any]], test: list[dict[str, Any]]) -> list[str]:
    """Match WR-TOOL-EVAL-5 baselines.json: L2 counts, vocab<=4000, 120 steps, lr 0.35."""
    vocab: dict[str, int] = {}
    for r in train:
        for t in tokenize(r["input"]):
            if t not in vocab and len(vocab) < 4000:
                vocab[t] = len(vocab)
    idx = {c: i for i, c in enumerate(CLASS_NAMES)}

    def mat(rows: list[dict[str, Any]]):
        x = np.zeros((len(rows), len(vocab)), dtype=np.float64)
        y = np.zeros(len(rows), dtype=np.int64)
        for i, r in enumerate(rows):
            y[i] = idx[r["gold_class"]]
            for t in tokenize(r["input"]):
                j = vocab.get(t)
                if j is not None:
                    x[i, j] += 1.0
            nrm = np.linalg.norm(x[i])
            if nrm:
                x[i] /= nrm
        return x, y

    xtr, ytr = mat(train)
    w = np.zeros((N_CLASSES, xtr.shape[1]))
    for c in range(N_CLASSES):
        yb = (ytr == c).astype(np.float64) * 2 - 1
        for _ in range(120):
            w[c] -= 0.35 * (xtr.T @ (xtr @ w[c] - yb)) / max(len(train), 1)
    pred = (mat(test)[0] @ w.T).argmax(axis=1)
    return [CLASS_NAMES[int(i)] for i in pred]


def lexical_rank(query: str, cards: list[dict[str, Any]]) -> list[tuple[str, float]]:
    q = set(tokenize(query))
    scored = []
    for c in cards:
        toks = set(tokenize(card_text(c)))
        inter = len(q & toks)
        uni = len(q | toks) or 1
        scored.append((c["tool_id"], inter / uni))
    scored.sort(key=lambda t: (-t[1], t[0]))
    return scored


def tfidf_rank(queries: list[str], cards: list[dict[str, Any]]) -> list[list[tuple[str, float]]]:
    from sklearn.feature_extraction.text import TfidfVectorizer

    docs = [card_text(c) for c in cards]
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
    mat = vec.fit_transform(docs + queries)
    cd = mat[: len(cards)]
    qd = mat[len(cards) :]
    sims = (qd @ cd.T).toarray()
    out = []
    ids = [c["tool_id"] for c in cards]
    for row in sims:
        order = np.argsort(-row)
        out.append([(ids[j], float(row[j])) for j in order])
    return out


def bm25_rank(queries: list[str], cards: list[dict[str, Any]], k1: float = 1.5, b: float = 0.75):
    docs = [tokenize(card_text(c)) for c in cards]
    N = len(docs)
    df: dict[str, int] = {}
    for d in docs:
        for t in set(d):
            df[t] = df.get(t, 0) + 1
    avgdl = sum(len(d) for d in docs) / max(N, 1)
    out = []
    ids = [c["tool_id"] for c in cards]
    for q in queries:
        qtoks = tokenize(q)
        scores = []
        for di, d in enumerate(docs):
            tf: dict[str, int] = {}
            for t in d:
                tf[t] = tf.get(t, 0) + 1
            dl = len(d) or 1
            s = 0.0
            for t in qtoks:
                if t not in tf:
                    continue
                n = df.get(t, 0)
                idf = math.log((N - n + 0.5) / (n + 0.5) + 1.0)
                freq = tf[t]
                s += idf * (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * dl / avgdl))
            scores.append((ids[di], s))
        scores.sort(key=lambda t: (-t[1], t[0]))
        out.append(scores)
    return out


def cosine_rank(query_vecs: np.ndarray, card_vecs: np.ndarray, cards: list[dict[str, Any]]):
    q = l2_normalize(query_vecs)
    c = l2_normalize(card_vecs)
    sims = q @ c.T
    ids = [card["tool_id"] for card in cards]
    out = []
    for row in sims:
        order = np.argsort(-row)
        out.append([(ids[j], float(row[j])) for j in order])
    return out


def ranks_to_pred(ranks: list[list[tuple[str, float]]], id_to_class: dict[str, str], none_id: str = "none"):
    preds = []
    for row in ranks:
        tid = row[0][0] if row else none_id
        preds.append(id_to_class.get(tid, "NO_TOOL"))
    return preds


def topk_hit(ranks: list[list[tuple[str, float]]], gold_ids: list[str], k: int) -> float:
    hits = 0
    n = 0
    for row, g in zip(ranks, gold_ids):
        n += 1
        top = {t[0] for t in row[:k]}
        hits += int(g in top)
    return float(hits / max(n, 1))


def abstention_stats(proba: np.ndarray, y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
    if proba is None:
        return {"available": False}
    top = np.sort(proba, axis=1)
    conf = top[:, -1]
    margin = top[:, -1] - top[:, -2]
    ent = -np.sum(proba * np.log(np.clip(proba, 1e-12, 1)), axis=1)
    correct = y_true == y_pred
    wrong_margin = float(np.mean(margin[~correct])) if np.any(~correct) else None
    right_margin = float(np.mean(margin[correct])) if np.any(correct) else None
    # simple threshold on val-style: if we threshold margin, accuracy among accepted
    thresholds = [0.02, 0.05, 0.10, 0.15, 0.20, 0.30]
    curves = []
    for t in thresholds:
        keep = margin >= t
        if not np.any(keep):
            curves.append({"margin_ge": t, "coverage": 0.0, "accuracy_on_kept": None})
            continue
        curves.append(
            {
                "margin_ge": t,
                "coverage": float(np.mean(keep)),
                "accuracy_on_kept": float(np.mean(correct[keep])),
                "n_kept": int(np.sum(keep)),
            }
        )
    return {
        "available": True,
        "mean_top1_confidence": float(np.mean(conf)),
        "mean_top1_top2_margin": float(np.mean(margin)),
        "mean_entropy": float(np.mean(ent)),
        "mean_margin_correct": right_margin,
        "mean_margin_incorrect": wrong_margin,
        "wrong_routes_lower_margin": bool(
            wrong_margin is not None and right_margin is not None and wrong_margin < right_margin
        ),
        "margin_coverage_curves": curves,
        "designed_codes": ["NO_COMPATIBLE_TOOL", "IDENTITY_AMBIGUOUS"],
        "production_enabled": False,
    }
