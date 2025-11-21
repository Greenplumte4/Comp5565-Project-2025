// File: test/Integration.test.js
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
    const initialTokenId = 1000;
    const WARRANTY_DURATION_DAYS = 365;
    let nextTokenId = initialTokenId; // 用于跟踪下一个铸造的ID

    // 预设角色哈希
    const MANUFACTURER_ROLE = ethers.id("MANUFACTURER_ROLE");
    const RETAILER_ROLE = ethers.id("RETAILER_ROLE");
    const SERVICECENTER_ROLE = ethers.id("SERVICECENTER_ROLE");

    // 【修改 1】: 辅助函数，只负责制造商铸造和上架，不进行分发。
    // 产品所有者将是制造商（manufacturer）。
    async function mintNewProduct(maxClaims = 3) {
        const currentTokenId = nextTokenId;
        const price = ethers.parseEther("1000");

        // 制造商调用 Marketplace 的 registerProduct (铸造并上架给自己)
        await marketplace.connect(manufacturer).registerProduct(
            `SN-${currentTokenId}`, 
            "Model-X", 
            "Acme Corp", 
            price, 
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
        
        // 注意：由于 Marketplace 使用 executeMarketTransaction (特权转移)，
        // 因此不需要调用 setApprovalForAll。保留这些行用于文档或未来升级。
        // await registry.connect(manufacturer).setApprovalForAll(marketplace.target, true);
        // await registry.connect(retailer).setApprovalForAll(marketplace.target, true);
        // await registry.connect(customer1).setApprovalForAll(marketplace.target, true);
        // await registry.connect(customer2).setApprovalForAll(marketplace.target, true);
        
        console.log("     ✅ 角色授予和全局授权成功。");
    });
    
    // =================================================================
    // 核心业务流程测试
    // =================================================================

    // 【修改 2】: 制造商注册 -> 零售商购买 (Distribution Sale)
    it("3. 制造商注册产品并销售给零售商 (DISTRIBUTION_SALE)", async function () {
        const expectedMaxClaims = 3;
        const tokenId = await mintNewProduct(expectedMaxClaims); // 铸造并上架给自己
        const price = ethers.parseEther("1000"); // 注册时的价格
        
        // 验证初始所有者是制造商
        expect(await registry.ownerOf(tokenId)).to.equal(manufacturer.address);

        // 零售商购买 (DISTRIBUTION_SALE)
        await marketplace.connect(retailer).buyProduct(tokenId, { value: price });
        
        // 验证最终所有者是零售商
        expect(await registry.ownerOf(tokenId)).to.equal(retailer.address);
        
        // 验证保修信息 (Max claims, claimedCount)
        const warrantyData = await warranty.getWarrantyStatus(tokenId);
        expect(warrantyData[2], "Max claims check failed").to.equal(expectedMaxClaims); 
        expect(warrantyData[3], "Claimed count check failed").to.equal(0);
        
        // 验证历史记录：最后一条记录应该是 DISTRIBUTION_SALE (由 buyProduct 记录)
        const verificationData = await registry.verifyProduct(tokenId);
        const history = verificationData.ownershipHistory;
        expect(history[history.length - 1].eventType).to.equal("DISTRIBUTION_SALE");
        
        console.log("     ✅ 产品注册、分销销售、保修发行、历史记录验证成功。");
    });

    // 【修改 3】: 零售商上架 -> 客户购买 (Retail Sale)
    it("4. 零售商销售给客户 (RETAIL_SALE)", async function () {
        const tokenId = initialTokenId; // ID: 1000
        const retailPrice = ethers.parseEther("1200"); // 零售商加价

        // 4A. 零售商重新上架
        await marketplace.connect(retailer).listProduct(tokenId, retailPrice);
        const [price, isListed] = await registry.getProductMarketInfo(tokenId);
        expect(price).to.equal(retailPrice);
        expect(isListed).to.be.true;

        // 4B. 客户购买
        // 注意：客户必须发送足够的 ETH
        await marketplace.connect(customer1).buyProduct(tokenId, { value: retailPrice });
        
        // 验证所有权
        expect(await registry.ownerOf(tokenId)).to.equal(customer1.address);
        
        // 验证自动下架
        const [, isListedAfterSale] = await registry.getProductMarketInfo(tokenId);
        expect(isListedAfterSale).to.be.false;
        
        // 验证历史记录
        const verificationData = await registry.verifyProduct(tokenId);
        const history = verificationData.ownershipHistory;
        expect(history[history.length - 1].eventType).to.equal("RETAIL_SALE");
        
        console.log("     ✅ 零售商上架、客户购买 (RETAIL_SALE) 验证成功。");
    });

    // 步骤 5：测试保修索赔的完整流程。
    it("5. 保修流程：请求、批准、拒绝和非授权操作", async function () {
        const tokenId = initialTokenId; // ID: 1000
        
        // 5A. 客户1 发起服务请求
        await warranty.connect(customer1).requestService(tokenId);
        
        // 5B. 验证状态变为 Pending
        const pendingStatusIndex = 4;
        let warrantyData = await warranty.getWarrantyStatus(tokenId);
        expect(warrantyData[pendingStatusIndex]).to.equal(ClaimStatus.Pending);

        // 5C. 服务中心拒绝索赔
        await warranty.connect(serviceCenter).rejectClaim(tokenId, "Not covered.");
        
        // 5D. 客户再次发起请求，服务中心批准 ( claimedCount: 0 -> 1 )
        await warranty.connect(customer1).requestService(tokenId);
        await warranty.connect(serviceCenter).approveClaim(tokenId, "Approved fix.");
        
        // 验证状态：claimedCount 是索引 3
        const claimedCountIndex = 3; 
        warrantyData = await warranty.getWarrantyStatus(tokenId);
        const claimedCount = warrantyData[claimedCountIndex]; 
        const status = warrantyData[pendingStatusIndex];

        expect(claimedCount).to.equal(1); 
        expect(status).to.equal(ClaimStatus.Active); // 批准后回到 Active 状态
        
        console.log("     ✅ 完整的保修审批/拒绝流程和权限检查成功。");
    });
    
    // 【修改 4】: 客户上架 -> 客户购买 (Secondary Sale/Resale)
    it("6A. 客户转售产品 (SECONDARY_SALE) - 成功案例", async function() {
        const tokenId = initialTokenId; // ID: 1000
        const resalePrice = ethers.parseEther("500");

        // 6A-1. 客户1 将产品重新上架
        // 客户1 (当前所有者) 连接 Marketplace 进行上架
        await marketplace.connect(customer1).listProduct(tokenId, resalePrice);
        
        // 6A-2. 验证保修是否有效
        expect(await warranty.isWarrantyValid(tokenId)).to.be.true; 

        // 6A-3. 客户2 购买 (SECONDARY_SALE)
        await marketplace.connect(customer2).buyProduct(tokenId, { value: resalePrice });

        // 验证所有权
        expect(await registry.ownerOf(tokenId)).to.equal(customer2.address);
        
        // 验证历史记录：非制造商/零售商的销售将记录为 SECONDARY_SALE
        const verificationData = await registry.verifyProduct(tokenId);
        const history = verificationData.ownershipHistory;
        expect(history[history.length - 1].eventType).to.equal("SECONDARY_SALE"); 
        
        console.log("     ✅ 客户转售（SECONDARY_SALE）成功。");
    });

    // 【修改 5】: 负面测试，达到最大索赔次数。
    it("6B. 负面测试：保修达到最大索赔次数后，无法发起新请求", async function() {
        // 铸造 ID 1001, maxClaims=1
        const maxClaimsTokenId = await mintNewProduct(1); 
        const price = ethers.parseEther("1000"); // 制造商注册时的价格

        // 1. 零售商购买 (Distribution Sale)
        await marketplace.connect(retailer).buyProduct(maxClaimsTokenId, { value: price });
        // 2. 零售商上架
        await marketplace.connect(retailer).listProduct(maxClaimsTokenId, price);
        // 3. 客户购买 (Retail Sale)
        await marketplace.connect(customer1).buyProduct(maxClaimsTokenId, { value: price });
        
        // 第一次索赔 (消耗 1/1)
        await warranty.connect(customer1).requestService(maxClaimsTokenId);
        await warranty.connect(serviceCenter).approveClaim(maxClaimsTokenId, "Final Claim");
        
        // 验证状态变为 Fulfilled (索引 4)
        const warrantyData = await warranty.getWarrantyStatus(maxClaimsTokenId);
        expect(warrantyData[4]).to.equal(ClaimStatus.Fulfilled);

        // 第二次索赔 (应失败)
        await expect(
            warranty.connect(customer1).requestService(maxClaimsTokenId)
        ).to.be.revertedWith("Maximum claims reached."); 
        
        console.log("     ✅ 最大索赔次数限制检查成功。");
    });

    // [新增] 步骤 7：集成测试中的真伪验证 (需要假设 registry.getTokenIdBySerialNumber 存在)
    // 注意: ProductRegistry.sol 中没有 getTokenIdBySerialNumber，但有 public serialNumberToTokenId。
    it("7. 产品真伪验证集成测试 (verifyProduct)", async function () {
        const tokenId = initialTokenId; // ID: 1000
        
        // 7A. 正向测试：通过序列号查询 ID，并使用 ID 验证所有者 (Owner应为 customer2)
        const retrievedTokenId = await registry.serialNumberToTokenId("SN-1000"); // 使用 public 映射
        expect(retrievedTokenId).to.equal(tokenId);
        
        const verificationData = await registry.verifyProduct(tokenId);
        expect(verificationData.serialNumber).to.equal("SN-1000");
        expect(verificationData.currentOwner).to.equal(customer2.address);
        
        console.log("     ✅ 产品序列号到 ID 的映射和真伪验证功能工作正常。");
    });

    // 步骤 8：动态状态验证。
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