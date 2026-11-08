import sys, pandas as pd, numpy as np
D = sys.argv[1]
ann = pd.read_csv(f"{D}/annotations.tsv", sep="\t", low_memory=False, usecols=["root_id","super_class","cell_type","side"])
ann["cell_type"] = ann.cell_type.fillna("")
e = pd.DataFrame(np.load(f"{D}/../edges5.npy"), columns=["pre","post","w"])
cols = ["T2","T2a","T3","Tm5f","Tm25","Li01","Li15","Tm21","LC9"]
lcs = ["LC10a","LC11"]
inp = set(ann.root_id[ann.cell_type.isin(cols)])
lc = set(ann.root_id[ann.cell_type.isin(lcs)])
# центральный слой: прямые выходы LC (≥5 синапсов), затем нисходящие за ещё один шаг
mid = set(e.post[e.pre.isin(lc)]) - lc - inp
dns = set(ann.root_id[ann.super_class=="descending"])
dn2 = set(e.post[e.pre.isin(mid)]) & dns
nodes = inp | lc | mid | dn2
sub = e[e.pre.isin(nodes) & e.post.isin(nodes)]
print("колонки на входе:", len(inp), " LC10a+LC11:", len(lc), " центр (AOTU и др.):", len(mid), " нисходящие:", len(dn2))
print("всего нейронов:", len(nodes), " связей:", len(sub), " синапсов:", int(sub.w.sum()))
print("вес файла, если int32+int32+uint16: %.1f МБ" % (len(sub)*10/1e6))
print("DN по сторонам:", ann[ann.root_id.isin(dn2)].side.value_counts().to_dict())
print("топ DN типов:", ann[ann.root_id.isin(dn2)].cell_type.value_counts().head(12).to_dict())
