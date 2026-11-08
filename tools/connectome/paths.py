import sys, pandas as pd, numpy as np
D = sys.argv[1]
ann = pd.read_csv(f"{D}/annotations.tsv", sep="\t", low_memory=False, usecols=["root_id","super_class","cell_class","cell_type","side","top_nt","pos_x","pos_y","pos_z"])
ann["cell_type"] = ann.cell_type.fillna("")
con = pd.read_feather(f"{D}/connections_783.feather", columns=["pre_pt_root_id","post_pt_root_id","syn_count"])
# суммируем по нейропилям: пара нейронов — одно ребро
e = con.groupby(["pre_pt_root_id","post_pt_root_id"], as_index=False).syn_count.sum()
e = e[e.syn_count >= 5]
print("edges >=5 syn:", len(e))
t = dict(zip(ann.root_id, ann.cell_type)); sc = dict(zip(ann.root_id, ann.super_class))
e["pre_t"] = e.pre_pt_root_id.map(t); e["post_t"] = e.post_pt_root_id.map(t)
e["post_sc"] = e.post_pt_root_id.map(sc); e["pre_sc"] = e.pre_pt_root_id.map(sc)
for tgt in ["LC10a","LC11"]:
    ins = e[e.post_t==tgt].groupby("pre_t").syn_count.sum().sort_values(ascending=False)
    print(f"\nвходы {tgt} (тип: синапсов):", ", ".join(f"{k}:{v}" for k,v in ins.head(10).items()))
    outs = e[e.pre_t==tgt].groupby("post_t").syn_count.sum().sort_values(ascending=False)
    print(f"выходы {tgt}:", ", ".join(f"{k}:{v}" for k,v in outs.head(10).items()))
# сколько шагов от LC10a до нисходящих
lc = set(ann.root_id[ann.cell_type=="LC10a"])
dns = set(ann.root_id[ann.super_class=="descending"])
frontier = lc; seen = set(lc)
for hop in range(1,5):
    nxt = set(e.post_pt_root_id[e.pre_pt_root_id.isin(frontier)]) - seen
    hit = nxt & dns
    print(f"шаг {hop}: новых нейронов {len(nxt)}, из них нисходящих {len(hit)}")
    seen |= nxt; frontier = nxt
    if len(seen) > 40000: break
# основные DN, куда сильнее всего приходит LC10a за 2-3 шага — по весу пути
np.save(f"{D}/../edges5.npy", e[["pre_pt_root_id","post_pt_root_id","syn_count"]].to_numpy())
