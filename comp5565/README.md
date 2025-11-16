# ⚙️ 基于区块链的产品生命周期和保修管理系统

## 产品发行

### 产品注册与分销

* **角色**：制造商
* **合约**：Marketplace (调用 ProductRegistry 和 WarrantyManager)
* **ProductRegistry**: 铸造新的 `tokenId`。制造商通过 Marketplace 调用，ProductRegistry 将 NFT 直接铸造给目标零售商 (R)。(0x0 -> R)
* **WarrantyManager**: 发行保修，状态设为 **Active (1)**
* **ProductRegistry**: 记录一次 `"INITIAL_DISTRIBUTION"` 业务事件，指明制造商 M 授权将产品分发给了零售商 R。

> ### 本部分的一个设计权衡点
> 在产品发行阶段 (M -> R)，我们选择直接将 NFT 铸造给零售商 (R) 的 **Gas 优化方案**。虽然这跳过了制造商在 ERC721 历史中的短暂所有权，但我们通过在 Marketplace 中强制记录 `INITIAL_DISTRIBUTION` 业务事件，确保了供应链溯源的完整性和清晰度，同时将每件产品的发行成本降至最低。

## 市场交易

### 零售商上架

* **角色**：零售商
* **合约**：ProductRegistry 
* 零售商设置价格 (ProductRegistry 记录)。产品进入 NFT 市场展示。

### 客户购买

* **角色**：客户
* **合约**：Marketplace
* **ProductRegistry**: 所有权 **R -> C**。
* **WarrantyManager**: 状态保持 **Active (1)**

### 客户转售

* **角色**：客户
* **合约**：Marketplace
* **ProductRegistry**: 所有权 **C -> C'**。 
* **WarrantyManager**: 状态保持 **Active (1)** (除非已过期或已履行)。

## 保修服务

### 客户请求服务

* **角色**：客户
* **合约**：WarrantyManager
* 合约执行所有权、保修期、索赔次数检查
* 状态 **Active(1) -> Pending (2)**

### 服务中心处理（批准）

场景：客户的保修请求属于保修范围

* **角色**：服务中心
* **合约**：WarrantyManager
* 增加 `claimedCount`
* **Pending (2) -> Active (1)** 或者 **Fulfilled (4)**
    * **Pending (2) -> Active (1)**：如果新的 `claimedCount` **小于** 最大索赔次数 (`maxClaims`)，保修重新激活，允许客户未来再次索赔。
    * **Fulfilled (4)**：如果新的 `claimedCount` **等于** 最大索赔次数 (`maxClaims`)，保修索赔次数已满，保修生命周期结束。

### 服务中心处理 (拒绝)

场景：当服务中心对处于 Pending (2) 状态的产品进行检查后，判定该问题

* **角色**：服务中心
* **合约**：WarrantyManager
* `claimedCount` 不变
* **Pending (2) -> Active (1)** （变为 Active (1) 说明客户下次有需求还可以继续申请）

## 状态查询

### 动态查询

* **角色**：任意用户
* **合约**：WarrantyManager
* 调用 `WarrantyManager.getWarrantyStatus()` 函数
* 发现当前时间已超过保修期，链上存储 **Active(1)**，因为没有交易发生来改变这个状态，但返回给用户的是 **Expired (3)**，代表已过期
* 发现当前时间没有过保修期，链上存储 **Active(1)**，返回给用户的是 **Active (1)**，代表仍在保修期