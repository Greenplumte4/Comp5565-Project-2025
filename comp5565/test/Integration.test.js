// File: test/Integration.test.js (最终版本，包含关键负面测试)

const { expect } = require("chai");
const { ethers } = require("hardhat");

// ClaimStatus 枚举，用于状态验证
const ClaimStatus = {
    None: 0,
    Active: 1,
    Pending: 2,
    Expired: 3,
    Fulfilled: 4
};

// System Integration Test: Product Lifecycle & Warranty：测试整个供应链系统的集成和业务逻辑。
describe("System Integration Test: Product Lifecycle & Warranty", function () {
    let roles, warranty, registry, marketplace;
    let deployer, manufacturer, retailer, serviceCenter, customer1, customer2;
    let initialTokenId = 1000;
    const WARRANTY_DURATION_DAYS = 365;
    let nextTokenId = initialTokenId; // 用于跟踪下一个铸造的ID

    // 预设角色哈希
    const MANUFACTURER_ROLE = ethers.id("MANUFACTURER_ROLE");
    const RETAILER_ROLE = ethers.id("RETAILER_ROLE");
    const SERVICECENTER_ROLE = ethers.id("SERVICECENTER_ROLE");

    // 辅助函数：铸造一个新产品，模拟制造商的分发流程。
    async function mintNewProduct(to, maxClaims = 3) {
        const currentTokenId = nextTokenId;
        // 调用 Marketplace 的注册分发函数
        await marketplace.connect(manufacturer).registerAndDistribute(
            to, 
            `SN-${currentTokenId}`, 
            "Model-X", 
            "Acme Corp", 
            ethers.parseEther("1000"), 
            "ipfs://warranty-terms",
            WARRANTY_DURATION_DAYS, 
            maxClaims
        );
        nextTokenId++;
        return currentTokenId;
    }

    // before：在所有测试开始前执行，获取测试账户。
    before(async function () {
        // 1. 获取测试账户
        [deployer, manufacturer, retailer, serviceCenter, customer1, customer2] = await ethers.getSigners();
    });

    // 步骤 1：部署所有合约并设置相互依赖的地址。
    it("1. 部署所有合约并执行链接 Setter 函数（验证部署顺序）", async function () {
        // --- 部署阶段 ---
        const RolesContract = await ethers.getContractFactory("RolesContract");
        roles = await RolesContract.deploy();
        
        const WarrantyManager = await ethers.getContractFactory("WarrantyManager");
        // 部署 WarrantyManager，传入 RolesContract 地址
        warranty = await WarrantyManager.deploy(roles.target);
        
        const ProductRegistry = await ethers.getContractFactory("ProductRegistry");
        // 部署 ProductRegistry，传入 RolesContract 和 WarrantyManager 地址
        registry = await ProductRegistry.deploy(roles.target, warranty.target);
        
        const Marketplace = await ethers.getContractFactory("Marketplace");
        // 部署 Marketplace，传入 RolesContract 和 WarrantyManager 地址
        marketplace = await Marketplace.deploy(roles.target, warranty.target);
        
        // --- 链接阶段 (Setter)：设置合约之间的相互引用 ---
        await warranty.setProductRegistryAddress(registry.target);
        // ProductRegistry 授权 Marketplace 进行受限转账
        await registry.setMarketplaceAddress(marketplace.target); 
        await marketplace.setProductRegistryAddress(registry.target);
        await warranty.setMarketplaceAddress(marketplace.target);
        
        // 验证链接成功：检查 ProductRegistry 是否正确引用了 Marketplace
        expect(await registry.marketplaceContract()).to.equal(marketplace.target);
        console.log("     ✅ 所有合约部署和链接成功！");
    });

    // 步骤 2：授予账户业务角色并设置全局授权。
    it("2. 授予角色给测试账户并设置全局授权", async function () {
        // 授予核心角色权限
        await roles.grantRole(MANUFACTURER_ROLE, manufacturer.address);
        await roles.grantRole(RETAILER_ROLE, retailer.address);
        await roles.grantRole(SERVICECENTER_ROLE, serviceCenter.address);
        
        // 授予 Marketplace 代理权限：允许 Marketplace 代表 Retailer 和 Customer1 转移资产。
        await registry.connect(retailer).setApprovalForAll(marketplace.target, true);
        await registry.connect(customer1).setApprovalForAll(marketplace.target, true);
        
        console.log("     ✅ 角色授予和全局授权成功。");
    });
    
    // =================================================================
    // 核心业务流程测试
    // =================================================================

    // 步骤 3：测试制造商首次注册产品并分发给零售商的端到端流程。（保持不变）
    it("3. 制造商注册产品并分配给零售商 (registerAndDistribute)", async function () {
        const tokenId = await mintNewProduct(retailer.address, 3);
        
        // 验证所有权：NFT 所有者应为零售商
        expect(await registry.ownerOf(tokenId)).to.equal(retailer.address);
        
        // 验证保修：检查保修的最大索赔次数
        const [, , maxClaims] = await warranty.getWarrantyStatus(tokenId);
        expect(maxClaims).to.equal(3);
        
        // 验证历史：检查首次分发事件记录 (验证 0x0 -> R + 业务记录 M -> R)
        const history = await registry.getOwnershipHistory(tokenId);
        expect(history[0].eventType).to.equal("INITIAL_DISTRIBUTION");
        expect(history[0].to).to.equal(retailer.address);
        
        console.log("     ✅ 产品注册、保修发行、历史记录验证成功。");
    });

    // 步骤 4：测试零售商将产品销售给客户的流程。（保持不变）
    it("4. 零售商销售给客户 (retailSaleToCustomer)", async function () {
        const tokenId = initialTokenId; // 使用步骤 3 铸造的 ID
        
        // 零售商调用 Marketplace 进行销售
        await marketplace.connect(retailer).retailSaleToCustomer(
            tokenId, 
            customer1.address // 销售给客户1
        );
        
        // 验证所有权：所有权已转移到客户1
        expect(await registry.ownerOf(tokenId)).to.equal(customer1.address);
        
        // 验证历史：检查零售销售事件记录
        const history = await registry.getOwnershipHistory(tokenId);
        expect(history.length).to.equal(2);
        expect(history[1].eventType).to.equal("RETAIL_SALE");
        expect(history[1].to).to.equal(customer1.address);
        
        console.log("     ✅ 零售销售和历史记录验证成功。");
    });

    // 步骤 5：测试保修索赔的完整流程和权限。（保持不变）
    it("5. 保修流程：请求、批准、拒绝和非授权操作", async function () {
        const tokenId = initialTokenId;
        
        // 5A. 客户1 发起服务请求
        await warranty.connect(customer1).requestService(tokenId);
        let [, , , claimedCount, status, ] = await warranty.getWarrantyStatus(tokenId);
        expect(status).to.equal(ClaimStatus.Pending); // ClaimStatus.Pending

        // 5B. 负面测试：非服务中心尝试批准应失败（权限检查）
        await expect(
            warranty.connect(customer1).approveClaim(tokenId, "Fake Approval")
        ).to.be.reverted; 

        // 5C. 服务中心拒绝索赔
        await warranty.connect(serviceCenter).rejectClaim(tokenId, "Not covered.");
        
        // 验证状态：状态变回 Active (1)，索赔次数保持 0
        [, , , claimedCount, status, ] = await warranty.getWarrantyStatus(tokenId);
        expect(status).to.equal(ClaimStatus.Active); // ClaimStatus.Active
        expect(claimedCount).to.equal(0); 

        // 5D. 客户再次发起请求，服务中心批准
        await warranty.connect(customer1).requestService(tokenId);
        await warranty.connect(serviceCenter).approveClaim(tokenId, "Approved fix.");
        
        // 验证状态：索赔次数增加到 1，状态回到 Active
        [, , , claimedCount, status, ] = await warranty.getWarrantyStatus(tokenId);
        expect(claimedCount).to.equal(1); 
        expect(status).to.equal(ClaimStatus.Active);
        
        console.log("     ✅ 完整的保修审批/拒绝流程和权限检查成功。");
    });
    
    // 步骤 6A：核心修改！成功测试，验证保修有效时客户转售已解除限制。
    it("6A. 客户转售产品 (customerResale) - 成功案例（保修有效时转售）", async function() {
        const tokenId = initialTokenId; // Token 1000. Owner is customer1.
        const newPrice = ethers.parseEther("500");

        // 检查：当前保修仍然有效
        expect(await warranty.isWarrantyValid(tokenId)).to.be.true;

        // 客户1 尝试通过 Marketplace 转售给客户2，**现在应该成功** (限制已解除)
        await expect(
            marketplace.connect(customer1).customerResale(
                tokenId, 
                customer2.address, 
                newPrice,
                true
            )
        ).to.not.be.reverted; // <<<< 修改：预期不再回退

        // 验证所有权：所有权转移到客户2
        expect(await registry.ownerOf(tokenId)).to.equal(customer2.address);

        // 验证历史：检查客户转售事件记录
        const history = await registry.getOwnershipHistory(tokenId);
        expect(history.slice(-1)[0].eventType).to.equal("CUSTOMER_RESALE");

        console.log("     ✅ 客户转售限制已解除，保修期内转售成功。");
    });

    // 步骤 6B：负面测试，验证达到最大索赔次数后的限制。（保持不变）
    it("6B. 负面测试：保修达到最大索赔次数后，无法发起新请求", async function() {
        // 铸造一个 maxClaims = 1 的新产品
        const maxClaimsTokenId = await mintNewProduct(retailer.address, 1); 

        // 零售商销售给 customer1
        await marketplace.connect(retailer).retailSaleToCustomer(
            maxClaimsTokenId, 
            customer1.address
        ); 

        // 1. 第一次请求和批准 (达到最大次数 1)
        await warranty.connect(customer1).requestService(maxClaimsTokenId);
        await warranty.connect(serviceCenter).approveClaim(maxClaimsTokenId, "Final Claim");

        // 验证状态：状态变为 Fulfilled (4)
        let [, , , claimedCount, status, ] = await warranty.getWarrantyStatus(maxClaimsTokenId);
        expect(status).to.equal(ClaimStatus.Fulfilled); // ClaimStatus.Fulfilled

        // 2. 尝试再次请求，应被阻止
        await expect(
            warranty.connect(customer1).requestService(maxClaimsTokenId)
            ).to.be.revertedWith("Maximum claims reached."); 
        
        console.log("     ✅ 最大索赔次数限制检查成功。");
    });

    // 步骤 6C：动态状态验证：模拟时间前进，验证保修状态动态变为 'Expired' (3)。
    it("6C. 动态状态验证：模拟时间前进，验证保修状态动态变为 'Expired' (3)", async function () {
        const tokenId = initialTokenId;
        
        // 模拟时间前进（跳过一年零一秒），使保修过期
        const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;
        await ethers.provider.send("evm_increaseTime", [ONE_YEAR_IN_SECONDS + 1]);
        await ethers.provider.send("evm_mine"); 
        
        // 验证保修状态：现在应该动态返回 Expired (3)
        // [startTime, duration, maxClaims, claimedCount, status, lastClaimDate]
        const [, , , , status] = await warranty.getWarrantyStatus(tokenId);
        expect(status).to.equal(ClaimStatus.Expired); // ClaimStatus.Expired = 3
        
        // 验证 isWarrantyValid：现在应该返回 false
        expect(await warranty.isWarrantyValid(tokenId)).to.be.false;
        
        console.log("     ✅ 动态保修状态验证（时间过期后变为 Expired）成功。");
    });
});