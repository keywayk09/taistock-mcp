# Decision Log 決策日誌

每一次正式引擎修改，都必須在此留下可追溯紀錄。

## Decision 模板

```markdown
# DEC-YYYYMMDD-001

- 日期：
- 引擎版本：
- 涉及策略：
- 對應 Hypothesis：
- 對應 Research Cases：
- 決策：接受／拒絕／延後／回滾

## 問題

## 修改內容

## 證據

- 支持案例數：
- 反例數：
- 修改前勝率／PF／MFE／MAE：
- 修改後勝率／PF／MFE／MAE：
- 高品質標籤保留率：
- 錯誤標籤降低幅度：
- 新增漏訊號：
- 新增錯誤訊號：

## 適用與不適用市場

## 已知副作用

## 上線條件

## 回滾條件

## 最終核准
```

## 原則

- 沒有 Research Case 與 Hypothesis，不進正式 Engine。
- 必須記錄修改成本，不只記錄改善。
- 必須保留回滾條件。
- 決策被推翻時不可刪除舊紀錄，應新增後續 Decision。
