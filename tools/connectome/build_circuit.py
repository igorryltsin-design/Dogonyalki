"""Сборка мозга Огонька из коннектома FlyWire v783.

Что делает:
1. Берёт все пары нейронов, связанных ≥ 5 синапсами (сумма по нейропилям).
2. Восстанавливает, куда в поле зрения «смотрит» каждый нейрон зрительной
   доли. Фоторецепторы R1–6 получают направление из своего положения в глазу
   (перед глаза — вперёд, верх — вверх), а каждый следующий нейрон — взвешенное
   синапсами среднее направлений тех, кто к нему подключён. Перекрёсты
   (хиазмы) между ламиной, медуллой и лобулой этим не путаются: направление
   переносится по связям, а не по координатам.
3. Вырезает путь погони: колонки, питающие LC10a и LC11 → сами LC10a и LC11 →
   их прямые выходы (оптический бугорок и др.) → нисходящие нейроны.
4. Пишет компактный JSON для игры: типы, стороны, знаки (по медиатору),
   3D-координаты (мкм), направления взгляда входных нейронов и связи в base64.

Запуск: python build_circuit.py <папка с данными> <выходной json>
"""

import base64
import json
import sys

import numpy as np
import pandas as pd

D = sys.argv[1]
OUT = sys.argv[2]
MIN_SYN = 5

ann = pd.read_csv(
    f"{D}/annotations.tsv",
    sep="\t",
    low_memory=False,
    usecols=["root_id", "super_class", "cell_class", "cell_type", "side", "top_nt", "pos_x", "pos_y", "pos_z"],
)
ann["cell_type"] = ann.cell_type.fillna("")
# координаты FAFB: x, y — воксели по 4 нм, z — срезы по 40 нм → микрометры
ann["X"] = ann.pos_x * 0.004
ann["Y"] = ann.pos_y * 0.004
ann["Z"] = ann.pos_z * 0.040

con = pd.read_feather(f"{D}/connections_783.feather", columns=["pre_pt_root_id", "post_pt_root_id", "syn_count"])
e = con.groupby(["pre_pt_root_id", "post_pt_root_id"], as_index=False).syn_count.sum()
e = e[e.syn_count >= MIN_SYN].rename(columns={"pre_pt_root_id": "pre", "post_pt_root_id": "post", "syn_count": "w"})
print("связей ≥5 синапсов:", len(e))

# ── 2. ретинотопия ────────────────────────────────────────────────────────
vis_classes = {"optic", "visual_projection", "sensory"}
vis = set(ann.root_id[ann.super_class.isin(vis_classes)])
ev = e[e.pre.isin(vis) & e.post.isin(vis)]

def eye_dirs(side: str):
    r = ann[(ann.cell_type == "R1-6") & (ann.side == side)]
    z = r.Z.to_numpy()
    y = r.Y.to_numpy()
    z0, z1 = np.percentile(z, [2, 98])
    y0, y1 = np.percentile(y, [2, 98])
    u = np.clip((z - z0) / (z1 - z0), 0, 1)  # 0 — перед глаза, 1 — зад
    v = np.clip((y - y0) / (y1 - y0), 0, 1)  # 0 — верх, 1 — низ
    sgn = 1 if side == "right" else -1
    az = np.radians(-10 + u * 160) * sgn  # глаз видит от −10° (перед) до 150° вбок
    el = np.radians(70 - v * 140)
    vec = np.stack([np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), np.sin(el)], axis=1)
    return pd.DataFrame(vec, index=r.root_id, columns=["vx", "vy", "vz"])

pos = pd.concat([eye_dirs("left"), eye_dirs("right")])
fixed = set(pos.index)
print("фоторецепторов с направлением:", len(pos))
for it in range(8):
    m = ev.merge(pos, left_on="pre", right_index=True)
    for c in ["vx", "vy", "vz"]:
        m[c] = m[c] * m.w
    agg = m.groupby("post")[["vx", "vy", "vz"]].sum()
    n = np.linalg.norm(agg.to_numpy(), axis=1, keepdims=True)
    agg = pd.DataFrame(agg.to_numpy() / np.maximum(n, 1e-9), index=agg.index, columns=["vx", "vy", "vz"])
    agg = agg[~agg.index.isin(fixed)]
    pos = pd.concat([pos[pos.index.isin(fixed)], agg])
    print(f"проход {it + 1}: нейронов с направлением {len(pos)}")

# ── 3. путь погони ────────────────────────────────────────────────────────
t = ann.set_index("root_id")
INPUT_TYPES = ["T2", "T2a", "T3", "Tm5f", "Tm25", "Li01", "Li15", "Tm21", "LC9"]
LC_TYPES = ["LC10a", "LC11"]
inp = set(ann.root_id[ann.cell_type.isin(INPUT_TYPES)]) & set(pos.index)
lc = set(ann.root_id[ann.cell_type.isin(LC_TYPES)])
mid = set(e.post[e.pre.isin(lc)]) - lc - inp
dns = set(ann.root_id[ann.super_class == "descending"])
dn = set(e.post[e.pre.isin(mid)]) & dns
mid -= dn
nodes = sorted(inp) + sorted(lc) + sorted(mid) + sorted(dn)
role = [0] * len(inp) + [1] * len(lc) + [2] * len(mid) + [3] * len(dn)
idx = {r: i for i, r in enumerate(nodes)}
sub = e[e.pre.isin(idx) & e.post.isin(idx)]
print("нейронов:", len(nodes), "связей:", len(sub), "синапсов:", int(sub.w.sum()))

# знак синапса — по медиатору пресинаптической клетки
SIGN = {"acetylcholine": 1, "gaba": -1, "glutamate": -1}
types = sorted({t.at[r, "cell_type"] or t.at[r, "super_class"] for r in nodes})
tix = {s: i for i, s in enumerate(types)}
side_ix = {"left": 0, "right": 1}

neurons = {
    "type": [tix[t.at[r, "cell_type"] or t.at[r, "super_class"]] for r in nodes],
    "side": [side_ix.get(t.at[r, "side"], 2) for r in nodes],
    "sign": [SIGN.get(t.at[r, "top_nt"], 0) for r in nodes],
    "role": role,
}
xyz = np.array([[t.at[r, "X"], t.at[r, "Y"], t.at[r, "Z"]] for r in nodes])
center = np.median(xyz[np.array(role) >= 1], axis=0)
xyz = np.round(xyz - center).astype(np.int16)

# направление взгляда (азимут, угол места, ×1000 рад) — у кого оно есть
vd = []
for r in nodes:
    if r in pos.index:
        vx, vy, vz = pos.loc[r]
        vd += [int(round(np.arctan2(vy, vx) * 1000)), int(round(np.arcsin(np.clip(vz, -1, 1)) * 1000))]
    else:
        vd += [-32768, -32768]

b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
out = {
    "source": "FlyWire FAFB v783 (Dorkenwald et al. 2024; Schlegel et al. 2024), связи ≥5 синапсов",
    "types": types,
    "n": len(nodes),
    "neurons": neurons,
    "xyz": b64(xyz.reshape(-1)),
    "view": b64(np.array(vd, dtype=np.int16)),
    "pre": b64(sub.pre.map(idx).to_numpy(dtype=np.uint16)),
    "post": b64(sub.post.map(idx).to_numpy(dtype=np.uint16)),
    "syn": b64(np.minimum(sub.w.to_numpy(), 65535).astype(np.uint16)),
}
with open(OUT, "w") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print("записано:", OUT)
