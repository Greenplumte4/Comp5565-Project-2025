// File: test/Unit_Marketplace.test.js (最终修正版本)

const { expect } = require("chai");
const { ethers } = require("hardhat");

// Unit Test: Marketplace：专注于测试 Marketplace 合约的权限和核心业务逻辑。
describe("Unit Test: Marketplace", function () {
    let roles, registry, warrantyManagerMock, marketplace;
    let deployer, manufacturer, retailer, customer1, customer2, user;

    const INITIAL_TOKEN_ID = 1000;
    let nextTokenId = INITIAL_TOKEN_ID; // 跟踪下一个 ID

    const TEST_SN = "SN-123";
    const TEST_PRICE = ethers.parseEther("100"); // 100 ETH

    // 辅助函数：铸造一个新产品，模拟制造商分发流程，并确保 ID 递增。
    async function mintNewProduct(to, price = TEST_PRICE) {
        const currentTokenId = nextTokenId;
        // 调用 Marketplace.registerAndDistribute
        await marketplace.connect(manufacturer).registerAndDistribute(
            to, TEST_SN, "ModelX", "MFG Inc.", price, "URI", 365, 3
        );
        nextTokenId++;
        return currentTokenId;
    }

    // before：在所有测试开始前，部署所有合约并设置依赖关系。
    before(async function () {
        [deployer, manufacturer, retailer, customer1, customer2, user] = await ethers.getSigners();
        
        // --- 1. 部署和角色分配 ---
        const RolesContract = await ethers.getContractFactory("RolesContract");
        roles = await RolesContract.deploy();

        // 授予核心业务角色
        await roles.grantRole(ethers.id("MANUFACTURER_ROLE"), manufacturer.address);
        await roles.grantRole(ethers.id("RETAILER_ROLE"), retailer.address);

        // 使用 MockWarrantyManager 模拟保修有效性，以便隔离测试 Marketplace 逻辑。
        const MockWarrantyManager = await ethers.getContractFactory("MockWarrantyManager");
        warrantyManagerMock = await MockWarrantyManager.deploy(true); // 默认设置为保修有效 (true)
        
        // 部署 Marketplace 和 ProductRegistry
        const Marketplace = await ethers.getContractFactory("Marketplace");
        marketplace = await Marketplace.deploy(roles.target, warrantyManagerMock.target);

        const ProductRegistry = await ethers.getContractFactory("ProductRegistry");
        registry = await ProductRegistry.deploy(roles.target, warrantyManagerMock.target);
        
        // 设置合约引用，解决循环依赖
        await registry.setMarketplaceAddress(marketplace.target);
        await marketplace.setProductRegistryAddress(registry.target);

        // 授权：允许 Marketplace 代表 Retailer 和 Customer 转移其拥有的 NFT。
        await registry.connect(retailer).setApprovalForAll(marketplace.target, true);
        await registry.connect(customer1).setApprovalForAll(marketplace.target, true);
        await registry.connect(customer2).setApprovalForAll(marketplace.target, true);
    });
    
    // --- Retailer Sale to Customer (RetailSaleToCustomer) 保持不变 ---
    describe("Retailer Sale to Customer (RetailSaleToCustomer)", function () {
        let tokenId; 
        
        beforeEach(async function() {
            tokenId = await mintNewProduct(retailer.address);
        });
        
        it("非零售商调用 retailSaleToCustomer 应该失败", async function () {
            await expect(
                marketplace.connect(customer1).retailSaleToCustomer(tokenId, customer1.address)
            ).to.be.revertedWith("MP: Only Retailer can sell.");
        });

        it("零售商不拥有产品时调用应该失败", async function () {
            await expect(
                marketplace.connect(retailer).retailSaleToCustomer(tokenId + 1000, customer1.address)
            ).to.be.reverted; 
        });

        it("保修无效时转让应该成功 (Retailer Sale 不检查保修)", async function () {
            const newOwner = customer1.address;
            
            await warrantyManagerMock.setValidStatus(false);
            
            await expect(
                marketplace.connect(retailer).retailSaleToCustomer(tokenId, newOwner)
            ).to.not.be.reverted; 
            
            expect(await registry.ownerOf(tokenId)).to.equal(newOwner);
            
            await warrantyManagerMock.setValidStatus(true); // 恢复有效状态
        });

        it("零售商应该能成功销售给客户", async function () {
            const newOwner = customer1.address;
            
            await warrantyManagerMock.setValidStatus(true); 

            await expect(
                marketplace.connect(retailer).retailSaleToCustomer(tokenId, newOwner)
            ).to.not.be.reverted;
            
            expect(await registry.ownerOf(tokenId)).to.equal(newOwner);
        });
    });

    // --- Customer Resale (CustomerResale) 核心修改 ---
    describe("Customer Resale (CustomerResale)", function () {
        let tokenId; 
        
        before(async function() {
            // 1. 铸造一个新的产品到 retailer
            const resaleTokenId = await mintNewProduct(retailer.address);
            tokenId = resaleTokenId;
            
            // 2. 零售商销售给 customer1 (完成零售流程，将产品转给客户)
            await warrantyManagerMock.setValidStatus(true); 
            await marketplace.connect(retailer).retailSaleToCustomer(tokenId, customer1.address);
            
            // 确认当前所有者是 customer1
            expect(await registry.ownerOf(tokenId)).to.equal(customer1.address);
        });
        
        it("非当前所有者调用 customerResale 应该失败", async function () {
            await expect(
                marketplace.connect(customer2).customerResale(tokenId, customer2.address, TEST_PRICE, true)
            ).to.be.revertedWith("MP: Only current owner can initiate resale.");
        });
        
        // 核心修改：现在应该成功！
        it("保修有效时转让应该成功 (限制已解除)", async function () {
            const newOwner = customer2.address;
            // 确保保修有效 (前提条件)
            await warrantyManagerMock.setValidStatus(true); 
            
            // 预期不再回退
            await expect(
                marketplace.connect(customer1).customerResale(tokenId, newOwner, TEST_PRICE, true)
            ).to.not.be.reverted;
            
            // 验证所有权转移
            expect(await registry.ownerOf(tokenId)).to.equal(newOwner);
        });
        
        // 验证保修失效时也成功（现在是冗余测试，但可以验证兼容性）
        it("客户应该能成功转售给新客户 (保修失效时也成功)", async function () {
            const newOwner = customer1.address;
            const RESALE_PRICE = ethers.parseEther("50");
            
            // 模拟保修失效 
            await warrantyManagerMock.setValidStatus(false); 
            
            await expect(
                marketplace.connect(customer2).customerResale(tokenId, newOwner, RESALE_PRICE, true)
            ).to.not.be.reverted; 

            // 验证所有权转移
            expect(await registry.ownerOf(tokenId)).to.equal(newOwner);
        });
    });

    // 新增：零售商上架 (listProductForSale) 功能测试
    describe("Retailer Listing (listProductForSale)", function () {
        let tokenId; 
        const LIST_PRICE = ethers.parseEther("999");
        
        before(async function() {
            // 铸造一个新的产品到 retailer 手中
            tokenId = await mintNewProduct(retailer.address);
        });
        
        it("零售商应该能够成功上架产品", async function () {
            await expect(
                marketplace.connect(retailer).listProductForSale(tokenId, LIST_PRICE)
            ).to.emit(marketplace, "ProductListed")
             .withArgs(tokenId, LIST_PRICE, retailer.address);
        });

        it("非零售商尝试上架产品应失败", async function () {
            await expect(
                marketplace.connect(customer1).listProductForSale(tokenId, LIST_PRICE)
            ).to.be.revertedWith("MP: Only Retailer can list.");
        });
    });
});