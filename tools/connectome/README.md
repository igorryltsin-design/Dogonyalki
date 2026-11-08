# Разведка коннектома FlyWire для «Огонька»

Скрипты, которыми проверялось, можно ли собрать мозг Огонька из настоящего
коннектома, а не из 48 весов. Данные в репозиторий не кладутся — их ~880 МБ.

## Данные

```bash
mkdir flywire-dl && cd flywire-dl
curl -L -o annotations.tsv https://github.com/flyconnectome/flywire_annotations/raw/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv
curl -L -o connections_783.feather "https://zenodo.org/records/10676866/files/proofread_connections_783.feather?download=1"
```

- связи FlyWire v783 — Zenodo 10.5281/zenodo.10676866, лицензия записи CC BY 4.0
  (Dorkenwald et al., Nature 2024);
- типы клеток — flyconnectome/flywire_annotations (Schlegel et al., Nature 2024).

Нужны Python 3.9+, pandas и pyarrow.

```bash
python explore.py flywire-dl   # типы клеток и колонки таблиц
python paths.py flywire-dl     # входы и выходы LC10a/LC11, шаги до нисходящих
python size.py flywire-dl      # размер подграфа «колонки → LC → AOTU → DN»
```

## Что получилось (v783, связи от 5 синапсов)

- 139 248 нейронов, 2,7 млн связей от 5 синапсов;
- LC11 питают T2, T3, Tm25, Li15 — путь маленьких движущихся целей;
- LC10a (погоня самца за самкой) — Tm5f, Li01, LC9; выход в AOTU;
- от LC10a до нисходящих нейронов — 2 шага (на втором уже 215 DN);
- подграф «колонки → LC10a/LC11 → их выходы → нисходящие»:
  10 210 нейронов, 78 184 связи, ~0,94 млн синапсов, < 1 МБ в файле.
