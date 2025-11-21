// File: test/Unit_Registry.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");

// Unit Test: ProductRegistry
describe("Unit Test: ProductRegistry", function () {
    let roles, registry, warrantyManagerMock;
    let marketplace, manufacturer, retailer, customer1, customer2, user;

    // 预设产品数据
    const PRODUCT_URI = "ipfs://product-metadata/1";
    
    // 关键修正: 所有 Token ID 和 Price 相关的数字都使用 BigInt (数字后带 n)
    const INITIAL_TOKEN_ID = 1000n; 
    const NEXT_TOKEN_ID = 1001n;
    const TEST_SERIAL_NUMBER = "SN-1"; // Token 1000 的序列号
    const TEST_MODEL_DETAILS = "ModelX"; 
    const TEST_MFG_DETAILS = "MFG Inc."; 
    const TEST_PRICE = 100n; // 铸造时的价格
    
    // before：在所有测试开始前，部署依赖合约并设置权限。
    before(async function () {
        // 获取测试账户，将第一个账户指定为 marketplace
        [marketplace, manufacturer, retailer, customer1, customer2, user] = await ethers.getSigners();

        // 1. 部署 RolesContract 并授予角色
        const RolesContract = await ethers.getContractFactory("RolesContract");
        roles = await RolesContract.deploy();

        // 确保角色权限被正确授予
        await roles.grantRole(ethers.id("MANUFACTURER_ROLE"), manufacturer.address);
        await roles.grantRole(ethers.id("RETAILER_ROLE"), retailer.address);

        // 2. 部署 WarrantyManager 模拟合约 (Mock)
        const MockWarrantyManager = await ethers.getContractFactory("MockWarrantyManager");
        warrantyManagerMock = await MockWarrantyManager.deploy(true); 

        // 3. 部署 ProductRegistry
        const ProductRegistry = await ethers.getContractFactory("ProductRegistry");
        registry = await ProductRegistry.deploy(
            roles.target,
            warrantyManagerMock.target
        );

        // 4. 设置 Marketplace 地址
        await registry.setMarketplaceAddress(marketplace.address);
    });
    
    // --- 铸造产品 (mintProduct) ---
    describe("铸造产品 (mintProduct)", function () {
        const tokenId = INITIAL_TOKEN_ID;

        it("非 Marketplace 调用 mintProduct 应失败 (Revert)", async function () {
            // 修正回滚信息以匹配合约: "Registry: Only Marketplace."
            await expect(
                registry.connect(retailer).mintProduct(
                    customer1.address, 
                    "SN-0", "ModelX", "MFG Inc.", 100n, PRODUCT_URI // 修正数字为 100n
                )
            ).to.be.revertedWith("Registry: Only Marketplace.");
        });

        it("Marketplace 应能成功铸造产品，并触发 Transfer 事件", async function () {
            await expect(
                registry.connect(marketplace).mintProduct(
                    customer1.address, 
                    TEST_SERIAL_NUMBER, 
                    TEST_MODEL_DETAILS, 
                    TEST_MFG_DETAILS, 
                    TEST_PRICE, 
                    PRODUCT_URI
                )
            ).to.emit(registry, "Transfer")
             .withArgs(ethers.ZeroAddress, customer1.address, tokenId);

            expect(await registry.ownerOf(tokenId)).to.equal(customer1.address);
            expect(await registry.serialNumberToTokenId(TEST_SERIAL_NUMBER)).to.equal(tokenId); 

            // 验证静态数据存储
            const staticD = await registry.staticData(tokenId);
            expect(staticD.serialNumber).to.equal(TEST_SERIAL_NUMBER);

            // 【测试修复】: 调用 verifyProduct 获取聚合数据，而不是直接调用 ownershipHistory Getter
            const data = await registry.verifyProduct(tokenId);
            
            // 验证铸造时记录的历史事件
            expect(data.ownershipHistory).to.have.lengthOf(1, "History should only have 1 entry from minting.");
            // 修正 eventType 以匹配合约中的设置
            expect(data.ownershipHistory[0].eventType).to.equal("MINT_LISTED"); 
        });

        it("连续铸造应增加代币ID", async function () {
            await registry.connect(marketplace).mintProduct(
                customer1.address, 
                "SN-2", "ModelY", "MFG Inc.", 200n, "uri/2" // 修正数字为 200n
            );
            // 修正 TokenID 比较，确保使用 BigInt
            expect(await registry.ownerOf(NEXT_TOKEN_ID)).to.equal(customer1.address);
        });
    });

    // --- 产品转让 (transferFrom) ---
    describe("产品转让 (transferFrom & safeTransferFrom)", function () {
        const tokenId = INITIAL_TOKEN_ID; // 1000n
        
        // 流程：C1 -> R -> C2 -> C1
        
        it("Customer 应能转让给 Retailer (标准 transferFrom)", async function () {
            await expect(
                registry.connect(customer1).transferFrom(customer1.address, retailer.address, tokenId)
            ).to.not.be.reverted;
            
            expect(await registry.ownerOf(tokenId)).to.equal(retailer.address);
        });

        it("Retailer 应能转让给 Customer (标准 transferFrom)", async function () {
            await expect(
                registry.connect(retailer).transferFrom(retailer.address, customer2.address, tokenId)
            ).to.not.be.reverted;
            
            expect(await registry.ownerOf(tokenId)).to.equal(customer2.address);
        });
        
        // 关键修正: 删除 restrictedTransferFrom 并使用标准的 transferFrom
        it("Customer 之间转让应成功，且不受保修状态影响", async function () {
            // 明确设置保修失效，但标准 transferFrom 不检查保修，应成功
            await warrantyManagerMock.setValidStatus(false); 
            
            // customer2 -> customer1 (使用标准 transferFrom)
            await expect(
                registry.connect(customer2).transferFrom(customer2.address, customer1.address, tokenId)
            ).to.not.be.reverted;
            
            expect(await registry.ownerOf(tokenId)).to.equal(customer1.address);
        });
        
        // 再次转移回 customer2，为后续的 verifyProduct 准备最终所有者
        it("恢复所有权至 customer2", async function () {
             await registry.connect(customer1).transferFrom(customer1.address, customer2.address, tokenId);
             expect(await registry.ownerOf(tokenId)).to.equal(customer2.address);
        });
    });

    // --- 特殊转让：Operator Transfer (approve/operator) ---
    describe("特殊转让：Operator Transfer", function () {
        const tokenId = NEXT_TOKEN_ID; // 1001n
        
        before(async function () {
            // Token 1001 当前所有者是 customer1 (来自铸造)
            // 将 tokenId 1001 转移到 customer2，准备测试环境
            // 关键修正: 删除 restrictedTransferFrom 并使用标准的 transferFrom
            await registry.connect(customer1).transferFrom(customer1.address, customer2.address, tokenId);
        });
        
        // 关键修正: 删除保修相关的断言
        it("授权人 (Approved) 转让应成功", async function () {
            // customer2 (owner) 授权 user
            await registry.connect(customer2).approve(user.address, tokenId);
            
            // user (被授权人) 尝试转让 C2 -> C1
            // 关键修正: 删除 restrictedTransferFrom 并使用标准的 transferFrom
            await expect(
                registry.connect(user).transferFrom(customer2.address, customer1.address, tokenId)
            ).to.not.be.reverted;

            expect(await registry.ownerOf(tokenId)).to.equal(customer1.address);
        });
    });

    // ======================================================
    // 产品真伪验证聚合查询功能测试 (verifyProduct)
    // ======================================================

    describe("真伪验证聚合查询 (verifyProduct)", function () {
        const tokenId = INITIAL_TOKEN_ID; // 1000n
        
        it("1. 通过序列号公有映射获取 Token ID 应该成功", async function () {
            // Public mapping serialNumberToTokenId 自动生成 Getter
            const retrievedId = await registry.serialNumberToTokenId(TEST_SERIAL_NUMBER);
            expect(retrievedId).to.equal(tokenId);
        });
        
        it("2. 查询不存在的序列号应该返回 0", async function () {
            const retrievedId = await registry.serialNumberToTokenId("SN-NON-EXISTENT");
            expect(retrievedId).to.equal(0n); // 关键修正: 确保 0 是 BigInt
        });

        it("3. 通过 Token ID 查询产品详情 (verifyProduct) 应该返回完整的聚合数据", async function () {
            // Token 1000 的最终所有者是 customer2 (来自转让流程的最后一步)
            const expectedOwner = customer2.address; 
            
            const data = await registry.verifyProduct(tokenId);
            
            // 验证静态数据
            expect(data.tokenId).to.equal(tokenId, "Token ID should match");
            expect(data.serialNumber).to.equal(TEST_SERIAL_NUMBER, "Serial Number should match");
            expect(data.modelDetails).to.equal(TEST_MODEL_DETAILS, "Model details should match");
            
            // 验证所有权信息
            expect(data.currentOwner).to.equal(expectedOwner, "Current owner should match final transfer");
            
            // 验证市场信息
            expect(data.currentPrice).to.equal(TEST_PRICE, "Current price should be 100");
            expect(data.isListed).to.be.true; // 铸造时 isListed 设为 true

            // 验证历史记录
            // 历史记录只包含铸造时的 MINT_LISTED (因为后续的 transferFrom 没有调用 recordOwnershipTransfer)
            expect(data.ownershipHistory).to.have.lengthOf(1, "History should only have 1 entry from minting.");
            expect(data.ownershipHistory[0].eventType).to.equal("MINT_LISTED"); // 修正事件类型
        });
        
        it("4. 查询不存在的 Token ID (verifyProduct) 应该失败", async function () {
            // 关键修正: 匹配合约中的回滚信息
            await expect(registry.verifyProduct(9999n)).to.be.revertedWith("PR: Does not exist.");
        });
        
        it("5. 获取用户库存 (getPlayerInventory) 应该返回所有拥有的 Token ID", async function () {
            // customer1 拥有 Token 1001
            const c1Inventory = await registry.getPlayerInventory(customer1.address);
            expect(c1Inventory).to.deep.equal([NEXT_TOKEN_ID]);

            // customer2 拥有 Token 1000
            const c2Inventory = await registry.getPlayerInventory(customer2.address);
            expect(c2Inventory).to.deep.equal([INITIAL_TOKEN_ID]);
        });
    });
});