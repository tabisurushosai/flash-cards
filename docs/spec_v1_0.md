# flash-cards (あんきカード) 仕様書 v1_0
## ゴール
表/裏の暗記カードで学習するChrome拡張。デッキ管理・自己採点・未習得カード優先の簡易復習。
## 絶対制約
外部API・通信なし/chrome.storage.localのみ/権限storageのみ/MV3・TS・Vite/UIはpopup内で完結。
## 機能
デッキCRUD/カードCRUD(表/裏)+並べ替え/学習モード(表示→めくる→できた/まだ)/「まだ」優先の復習順/起動時復元/i18n ja-en/無料はデッキ2つ、Premium($3買い切り7日トライアル)で無制限+シャッフル+正答率。
## 完了条件
npm run build成功・dist生成・_locales ja/en・icons16/48/128・release/flash-cards.zip生成。
