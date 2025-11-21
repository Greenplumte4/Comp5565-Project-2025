// File: test/Unit_Marketplace.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Unit Test: Marketplace (E-Commerce Model)", function () {
    let roles, registry, warrantyManager, marketplace;
    let deployer, manufacturer, retailer, customer1, customer2, user;

    // 初始 ID 从 1000 开始 (对应 ProductRegistry 的 _nextTokenId)
    let nextTokenId = 1000;

    const TEST_SN_PREFIX = "SN-";
    const PRICE_MFG = ethers.parseEther("50");      // 制造商出厂价
    const PRICE_RETAIL = ethers.parseEther("100");  // 零售商售价
    const PRICE_RESALE = ethers.parseEther("80");   // 客户二手转售价

    // 辅助函数：制造商注册新产品 (Mint & List)
    async function registerProduct(price = PRICE_MFG) {
        const currentId = nextTokenId;
        const sn = TEST_SN_PREFIX + currentId;

        await marketplace.connect(manufacturer).registerProduct(
            sn,
            "Model-X",
            "MFG Inc.",
            price,
            "https://warranty.com/terms",
            365, // 保修天数
            3    // 最大索赔次数
        );
        
        nextTokenId++;
        return currentId;
    }

    before(async function () {
        [deployer, manufacturer, retailer, customer1, customer2, user] = await ethers.getSigners();

        // --- 1. 部署合约 ---
        
        // A. Roles
        const RolesContract = await ethers.getContractFactory("RolesContract");
        roles = await RolesContract.deploy();
        
        // B. WarrantyManager (使用真实合约)
        const WarrantyManager = await ethers.getContractFactory("WarrantyManager");
        warrantyManager = await WarrantyManager.deploy(roles.target);

        // C. ProductRegistry
        const ProductRegistry = await ethers.getContractFactory("ProductRegistry");
        registry = await ProductRegistry.deploy(roles.target, warrantyManager.target);

        // D. Marketplace
        const Marketplace = await ethers.getContractFactory("Marketplace");
        marketplace = await Marketplace.deploy(roles.target, warrantyManager.target);

        // --- 2. 关键配置：连接所有合约地址 ---
        await marketplace.setProductRegistryAddress(registry.target);
        await warrantyManager.setProductRegistryAddress(registry.target);
        await warrantyManager.setMarketplaceAddress(marketplace.target);
        
        // **最关键的一步：授权 Marketplace 操作 Registry**
        await registry.setMarketplaceAddress(marketplace.target);

        // --- 3. 授予角色 ---
        await roles.grantRole(ethers.id("MANUFACTURER_ROLE"), manufacturer.address);
        await roles.grantRole(ethers.id("RETAILER_ROLE"), retailer.address);
        // 如果需要测试保修流程，应添加 ServiceCenter 角色
    });

    // =============================================================
    // 测试场景 1: 制造商注册 (Register)
    // =============================================================
    describe("1. Manufacturer Registration", function () {
        it("制造商应能成功注册并上架产品", async function () {
            const tokenId = await registerProduct(PRICE_MFG);

            // 验证：所有者应该是制造商
            expect(await registry.ownerOf(tokenId)).to.equal(manufacturer.address);

            // 验证：市场信息 (价格正确，且已上架)
            const marketInfo = await registry.getProductMarketInfo(tokenId);
            expect(marketInfo.price).to.equal(PRICE_MFG);
            expect(marketInfo.isListed).to.be.true;

            // 验证：库存查询 (Manufacturer Inventory)
            const inventory = await registry.getPlayerInventory(manufacturer.address);
            // 修正：将 tokenId 转换为 BigInt 类型，以匹配 inventory 数组中的元素类型
            expect(inventory).to.include(BigInt(tokenId)); 
        }); // <--- 【修正点】: 闭合 it 块

        it("非制造商不能注册", async function () {
            await expect(
                marketplace.connect(retailer).registerProduct(
                    "SN-FAIL", "Model", "MFG", PRICE_MFG, "URI", 365, 3
                )
            ).to.be.revertedWith("MP: Only Manufacturer can register.");
        });
    });

    // =============================================================
    // 测试场景 2: 零售商进货 (Buy from Manufacturer)
    // =============================================================
    describe("2. Retailer Buying (Distribution)", function () {
        let tokenId;

        beforeEach(async function () {
            tokenId = await registerProduct(PRICE_MFG);
        });

        it("零售商应能支付 ETH 并购买产品", async function () {
            // 记录购买前的余额 (可选)
            // const oldBal = await ethers.provider.getBalance(manufacturer.address);

            // 零售商购买：必须发送 value
            await expect(
                marketplace.connect(retailer).buyProduct(tokenId, { value: PRICE_MFG })
            )
            .to.emit(marketplace, "ProductSold")
            .withArgs(tokenId, retailer.address, manufacturer.address, PRICE_MFG);

            // 验证 1：所有权转移
            expect(await registry.ownerOf(tokenId)).to.equal(retailer.address);

            // 验证 2：自动下架 (买到后默认不在售)
            const marketInfo = await registry.getProductMarketInfo(tokenId);
            expect(marketInfo.isListed).to.be.false;

            // 验证 3：历史记录类型
            const verifyData = await registry.verifyProduct(tokenId);
            const lastLog = verifyData.ownershipHistory[verifyData.ownershipHistory.length - 1];
            expect(lastLog.eventType).to.equal("DISTRIBUTION_SALE");
        });

        it("普通客户不能直接购买制造商的商品 (供应链限制)", async function () {
            // 尝试用客户账号购买
            await expect(
                marketplace.connect(customer1).buyProduct(tokenId, { value: PRICE_MFG })
            ).to.be.revertedWith("MP: Only Retailers can buy from Manufacturer.");
        });

        it("支付金额不足应该失败", async function () {
            await expect(
                marketplace.connect(retailer).buyProduct(tokenId, { value: ethers.parseEther("0.01") })
            ).to.be.revertedWith("MP: Insufficient funds sent.");
        });
    });

    // =============================================================
    // 测试场景 3: 零售销售 (Retail Sale)
    // =============================================================
    describe("3. Retailer Sale to Customer", function () {
        let tokenId;

        beforeEach(async function () {
            // 1. 制造商注册
            tokenId = await registerProduct(PRICE_MFG);
            // 2. 零售商买入
            await marketplace.connect(retailer).buyProduct(tokenId, { value: PRICE_MFG });
        });

        it("零售商上架产品 (List)", async function () {
            // 零售商设定新价格并上架
            await expect(
                marketplace.connect(retailer).listProduct(tokenId, PRICE_RETAIL)
            )
            .to.emit(marketplace, "ProductListed")
            .withArgs(tokenId, PRICE_RETAIL, retailer.address);

            const marketInfo = await registry.getProductMarketInfo(tokenId);
            expect(marketInfo.isListed).to.be.true;
            expect(marketInfo.price).to.equal(PRICE_RETAIL);
        });

        it("客户应能购买零售商上架的产品", async function () {
            // 先上架
            await marketplace.connect(retailer).listProduct(tokenId, PRICE_RETAIL);

            // 客户购买
            await expect(
                marketplace.connect(customer1).buyProduct(tokenId, { value: PRICE_RETAIL })
            )
            .to.emit(marketplace, "ProductSold")
            .withArgs(tokenId, customer1.address, retailer.address, PRICE_RETAIL);

            // 验证所有权
            expect(await registry.ownerOf(tokenId)).to.equal(customer1.address);
            
            // 验证历史记录
            const verifyData = await registry.verifyProduct(tokenId);
            const lastLog = verifyData.ownershipHistory[verifyData.ownershipHistory.length - 1];
            expect(lastLog.eventType).to.equal("RETAIL_SALE");
        });
    });

    // =============================================================
    // 测试场景 4: 客户二手转卖 (Customer Resale)
    // =============================================================
    describe("4. Customer Resale (Secondary Market)", function () {
        let tokenId;

        beforeEach(async function () {
            // 完整流程：Mfg -> Retailer -> Customer1
            tokenId = await registerProduct(PRICE_MFG);
            await marketplace.connect(retailer).buyProduct(tokenId, { value: PRICE_MFG });
            await marketplace.connect(retailer).listProduct(tokenId, PRICE_RETAIL);
            await marketplace.connect(customer1).buyProduct(tokenId, { value: PRICE_RETAIL });
        });

        it("客户1 应能转卖给 客户2", async function () {
            // 1. 客户1 上架
            await marketplace.connect(customer1).listProduct(tokenId, PRICE_RESALE);

            // 2. 客户2 购买
            await expect(
                marketplace.connect(customer2).buyProduct(tokenId, { value: PRICE_RESALE })
            )
            .to.emit(marketplace, "ProductSold")
            .withArgs(tokenId, customer2.address, customer1.address, PRICE_RESALE);

            // 验证所有权
            expect(await registry.ownerOf(tokenId)).to.equal(customer2.address);

            // 验证历史记录 (SECONDARY_SALE)
            const verifyData = await registry.verifyProduct(tokenId);
            const lastLog = verifyData.ownershipHistory[verifyData.ownershipHistory.length - 1];
            expect(lastLog.eventType).to.equal("SECONDARY_SALE");
        });

        it("非拥有者不能上架", async function () {
            await expect(
                marketplace.connect(customer2).listProduct(tokenId, PRICE_RESALE)
            ).to.be.revertedWith("MP: Not owner.");
        });
    });
});