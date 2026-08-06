# Playbook 交易手冊

Playbook 只收錄已經過大量案例驗證、可以清楚執行的交易模型。

## 與 Knowledge 的差別

- `knowledge/`：研究結論與規則。
- `playbook/`：可直接執行的完整交易模型。

## 每個 Playbook 必須包含

1. 型態名稱
2. 適用市場與時間週期
3. 必要市場背景
4. 觸發條件
5. 價格承諾條件
6. 進場位置
7. 停損與失效點
8. 前方空間與最低風報比
9. 出場方式
10. 禁止交易條件
11. 正例與反例
12. 歷史樣本、PF、MFE、MAE
13. 對應 Knowledge 與 Decision ID

## 建議主題

- L2 第一回踩
- S1 高檔刺穿收回
- S2 高不過高
- S5 掃高失敗
- RBND 支撐反彈
- 真突破與假突破
- 趨勢線突破回測
- VWAP 二次承諾
- Opening Drive
- 台指期背景否決

## 升級規則

Research 案例不能直接進 Playbook。必須經過：

```text
Research
→ Hypothesis
→ Experiment
→ Knowledge
→ Decision Log
→ Playbook
```
