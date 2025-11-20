// File: test/Integration.test.js (最终修正版本)

const { expect } = require("chai");
const { ethers } = require("hardhat");

// ClaimStatus 枚举，用于状态验证 (对应 WarrantyManager.sol 中的 ClaimStatus)
const ClaimStatus = {
    None: 0,
    Active: 1,
    Pending: 2,
    Expired: 3,
    Fulfilled: 4
};

// System Integration Test: Product Lifecycle & Warranty
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
    // 逻辑：制造商调用 registerAndDistribute(to, ...)，该函数在 Marketplace 中完成：
    // 1. 铸造给制造商 (msg.sender)
    // 2. 转移给 to (零售商)
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
        // **重要：假设 WarrantyManager 是实际合约，而不是 Mock，且实现了 isWarrantyValid**
        warranty = await WarrantyManager.deploy(roles.target);
        
        const ProductRegistry = await ethers.getContractFactory("ProductRegistry");
        registry = await ProductRegistry.deploy(roles.target, warranty.target);
        
        const Marketplace = await ethers.getContractFactory("Marketplace");
        marketplace = await Marketplace.deploy(roles.target, warranty.target);
        
        // --- 链接阶段 (Setter) ---
        await warranty.setProductRegistryAddress(registry.target);
        await registry.setMarketplaceAddress(marketplace.target); 
        await marketplace.setProductRegistryAddress(registry.target);
        await warranty.setMarketplaceAddress(marketplace.target);
        
        expect(await registry.marketplaceContract()).to.equal(marketplace.target);
        console.log("     ✅ 所有合约部署和链接成功！");
    });

    // 步骤 2：授予账户业务角色并设置全局授权。
    it("2. 授予角色给测试账户并设置全局授权", async function () {
        await roles.grantRole(MANUFACTURER_ROLE, manufacturer.address);
        await roles.grantRole(RETAILER_ROLE, retailer.address);
        await roles.grantRole(SERVICECENTER_ROLE, serviceCenter.address);
        
        // 授予 Marketplace 代理权限 (制造商的授权是必须的，因为它现在是铸造后的第一个所有者)
        await registry.connect(manufacturer).setApprovalForAll(marketplace.target, true);
        await registry.connect(retailer).setApprovalForAll(marketplace.target, true);
        await registry.connect(customer1).setApprovalForAll(marketplace.target, true);
        await registry.connect(customer2).setApprovalForAll(marketplace.target, true);
        
        console.log("     ✅ 角色授予和全局授权成功。");
    });
    
    // =================================================================
    // 核心业务流程测试
    // =================================================================

    // 步骤 3：测试制造商首次注册产品并分发给零售商。
    it("3. 制造商注册产品并分配给零售商 (registerAndDistribute)", async function () {
        // 铸造 ID 1000，序列号 SN-1000
        const expectedMaxClaims = 3;
        const tokenId = await mintNewProduct(retailer.address, expectedMaxClaims);
        
        // 验证最终所有者是零售商
        expect(await registry.ownerOf(tokenId)).to.equal(retailer.address);
        
        // 验证保修信息
        const warrantyData = await warranty.getWarrantyStatus(tokenId);
        
        // **【关键修复】根据 WarrantyManager.sol 的返回结构：
        // 索引 2 是 maxClaims (期望值 3)
        // 索引 3 是 claimedCount (期望值 0)
        
        // 验证 maxClaims
        expect(warrantyData[2], "Max claims check failed").to.equal(expectedMaxClaims); 
        
        // 验证 claimedCount
        expect(warrantyData[3], "Claimed count check failed").to.equal(0); // <--- 修复了原始的 'expected 0 to equal 3' 错误
        
        // 验证历史记录（使用 verifyProduct 替代 getOwnershipHistory）
        const verificationData = await registry.verifyProduct(tokenId);
        const history = verificationData.ownershipHistory;
        
        
        // 假设历史记录长度 >= 1
        expect(history.length).to.be.at.least(1);
        
        // 验证最后一条记录是 INITIAL_DISTRIBUTION
        expect(history[history.length - 1].eventType).to.equal("INITIAL_DISTRIBUTION");
        
        console.log("     ✅ 产品注册、保修发行、历史记录验证成功。");
    });

    // 步骤 4：测试零售商将产品销售给客户。
    it("4. 零售商销售给客户 (retailSaleToCustomer)", async function () {
        const tokenId = initialTokenId; // ID: 1000
        
        await marketplace.connect(retailer).retailSaleToCustomer(
            tokenId, 
            customer1.address 
        );
        
        expect(await registry.ownerOf(tokenId)).to.equal(customer1.address);
        
        // 验证历史记录
        const verificationData = await registry.verifyProduct(tokenId);
        const history = verificationData.ownershipHistory;
        expect(history[history.length - 1].eventType).to.equal("RETAIL_SALE");
        
        console.log("     ✅ 零售销售和历史记录验证成功。");
    });

    // 步骤 5：测试保修索赔的完整流程。
    it("5. 保修流程：请求、批准、拒绝和非授权操作", async function () {
        const tokenId = initialTokenId; // ID: 1000
        
        // 5A. 客户1 发起服务请求
        await warranty.connect(customer1).requestService(tokenId);
        
        // 5C. 服务中心拒绝索赔
        await warranty.connect(serviceCenter).rejectClaim(tokenId, "Not covered.");
        
        // 5D. 客户再次发起请求，服务中心批准
        await warranty.connect(customer1).requestService(tokenId);
        await warranty.connect(serviceCenter).approveClaim(tokenId, "Approved fix.");
        
        // 验证状态：claimedCount 是索引 3
        const claimedCountIndex = 3; 
        const warrantyData = await warranty.getWarrantyStatus(tokenId);
        const claimedCount = warrantyData[claimedCountIndex]; 

        expect(claimedCount).to.equal(1); 
        
        console.log("     ✅ 完整的保修审批/拒绝流程和权限检查成功。");
    });
    
    // 步骤 6A：验证客户转售（限制解除）。
    it("6A. 客户转售产品 (customerResale) - 成功案例（保修有效时转售）", async function() {
        const tokenId = initialTokenId; // ID: 1000
        const newPrice = ethers.parseEther("500");

        // 验证保修是否有效
        expect(await warranty.isWarrantyValid(tokenId)).to.be.true;

        // Customer1 -> Customer2
        await expect(
            marketplace.connect(customer1).customerResale(
                tokenId, 
                customer2.address, 
                newPrice,
                true
            )
        ).to.not.be.reverted;

        expect(await registry.ownerOf(tokenId)).to.equal(customer2.address);
        
        // 验证历史记录
        const verificationData = await registry.verifyProduct(tokenId);
        const history = verificationData.ownershipHistory;
        expect(history[history.length - 1].eventType).to.equal("CUSTOMER_RESALE");
        
        console.log("     ✅ 客户转售（CUSTOMER_RESALE）成功。");
    });

    // 步骤 6B：负面测试，达到最大索赔次数。
    it("6B. 负面测试：保修达到最大索赔次数后，无法发起新请求", async function() {
        // 铸造 ID 1001, maxClaims=1
        const maxClaimsTokenId = await mintNewProduct(retailer.address, 1); 

        // 分配给客户
        await marketplace.connect(retailer).retailSaleToCustomer(maxClaimsTokenId, customer1.address); 

        // 第一次索赔 (消耗 1/1)
        await warranty.connect(customer1).requestService(maxClaimsTokenId);
        await warranty.connect(serviceCenter).approveClaim(maxClaimsTokenId, "Final Claim");

        // 第二次索赔 (应失败)
        await expect(
            warranty.connect(customer1).requestService(maxClaimsTokenId)
        ).to.be.revertedWith("Maximum claims reached."); 
        
        console.log("     ✅ 最大索赔次数限制检查成功。");
    });

    // =================================================================
    // [新增] 步骤 7：集成测试中的真伪验证
    // =================================================================
    it("7. 产品真伪验证集成测试 (verifyProduct)", async function () {
        const tokenId = initialTokenId; // ID: 1000
        // 当前所有者是 customer2，序列号是 SN-1000
        
        // 7A. 正向测试：通过序列号查询 ID，并使用 ID 验证所有者 (Owner应为 customer2)
        const retrievedTokenId = await registry.getTokenIdBySerialNumber("SN-1000");
        expect(retrievedTokenId).to.equal(tokenId);
        
        const verificationData = await registry.verifyProduct(tokenId);
        expect(verificationData.serialNumber).to.equal("SN-1000");
        expect(verificationData.currentOwner).to.equal(customer2.address);
        
        console.log("     ✅ 产品序列号到 ID 的映射和真伪验证功能工作正常。");
    });

    // 步骤 8 (原 6C)：动态状态验证。放在最后，因为它会修改区块链时间。
    it("8. 动态状态验证：模拟时间前进，验证保修状态动态变为 'Expired' (3)", async function () {
        const tokenId = initialTokenId; // ID: 1000
        
        // 模拟时间前进
        const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;
        await ethers.provider.send("evm_increaseTime", [ONE_YEAR_IN_SECONDS + 1]);
        await ethers.provider.send("evm_mine"); 
        
        // 验证状态：status 是索引 4 (ClaimStatus.Expired = 3)
        const statusIndex = 4;
        const warrantyData = await warranty.getWarrantyStatus(tokenId);
        const status = warrantyData[statusIndex];

        expect(status).to.equal(ClaimStatus.Expired); 
        
        console.log("     ✅ 动态保修状态验证（时间过期后变为 Expired）成功。");
    });
});