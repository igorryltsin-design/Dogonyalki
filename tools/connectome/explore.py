import sys, pandas as pd
D = sys.argv[1]
ann = pd.read_csv(f"{D}/annotations.tsv", sep="\t", low_memory=False)
print("neurons:", len(ann))
print(ann.super_class.value_counts().head(12).to_string())
ct = ann.cell_type.fillna("")
for pat in ["LC10", "LC11", "LC9", "LPLC2", "LC4", "T4", "T5", "R1-6", "R7", "R8", "L1", "L2", "Tm1", "Tm2", "Tm3", "Tm4", "Tm9"]:
    m = ct.str.match(pat + r"($|[a-z_])") if pat not in ("R1-6",) else ct.str.startswith("R1-6")
    sub = ann[m]
    print(pat, len(sub), sorted(sub.cell_type.unique())[:8])
dn = ann[ann.super_class == "descending"]
print("descending:", len(dn))
con = pd.read_feather(f"{D}/connections_783.feather")
print(con.columns.tolist(), len(con))
print(con.head(3).to_string())
