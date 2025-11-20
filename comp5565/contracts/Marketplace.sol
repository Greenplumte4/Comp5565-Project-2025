// File: Marketplace.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./I_Interfaces.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; 

// Marketplace 合约：作为协调中心，负责产品在供应链中的分发、销售和转售流程。
contract Marketplace is Ownable { 
    
    // accessControl：角色管理合约，用于验证交易发起人是否具备制造商、零售商等身份。
    IRolesContract public accessControl;
    // warrantyManager：保修管理合约，负责产品的保修状态的发行和记录。
    IWarrantyManager public warrantyManager;
    // productRegistry：产品注册合约（NFT），负责产品的铸造、所有权追踪和元数据管理。
    IProductRegistry public productRegistry; 

    // 新增事件：用于通知产品已成功上架
    event ProductListed(
        uint256 indexed productId,
        uint256 price,
        address indexed seller
    );

    // 构造函数：初始化 Marketplace 运行所需的外部合约引用。
    constructor(
        address _accessControl, 
        address _warrantyManager
    ) Ownable(msg.sender) { // 初始化 Ownable
        require(_accessControl != address(0) && _warrantyManager != address(0), "Invalid address");
        accessControl = IRolesContract(_accessControl);
        warrantyManager = IWarrantyManager(_warrantyManager);
    }

    // setProductRegistryAddress：设置 ProductRegistry 合约的地址。
    function setProductRegistryAddress(address _registryAddr) public onlyOwner { 
        // 确保 ProductRegistry 尚未设置，防止重复初始化或被恶意覆盖。
        require(address(productRegistry) == address(0), "MP: Registry already set.");
        require(_registryAddr != address(0), "MP: Invalid address.");
        productRegistry = IProductRegistry(_registryAddr);
    }

    // registerAndDistribute：制造商首次将新产品引入区块链并分发给零售商的流程。
    function registerAndDistribute(
        address retailerAddress,
        string memory serialNumber,
        string memory modelDetails,
        string memory manufacturerDetails,
        uint256 price,
        string memory warrantyTermsURI,
        uint256 durationDays,
        uint8 maxClaims // <-- 这里不能有逗号
    ) external {
        // 权限检查：确保调用者是制造商，且目标是授权零售商。
        require(accessControl.isManufacturer(msg.sender), "MP: Only Manufacturer can register.");
        require(accessControl.isRetailer(retailerAddress), "MP: Target is not a Retailer.");
        require(address(productRegistry) != address(0), "MP: Registry not set."); 

        // -------------------------------------------------------------
        // 1. 铸造 NFT：【修正】所有权首先给制造商 (msg.sender)。
        // -------------------------------------------------------------
        uint256 tokenId = productRegistry.mintProduct(
            msg.sender, // <--- 关键修正：铸造给制造商 (msg.sender)
            serialNumber,
            modelDetails,
            manufacturerDetails,
            price,
            warrantyTermsURI
        );

        // 2. 初始保修：调用 WarrantyManager 启动产品的保修期。
        warrantyManager.issueWarranty(tokenId, durationDays, maxClaims);

        // -------------------------------------------------------------
        // 3. 转移：从制造商 (msg.sender) 转移给零售商 (retailerAddress)。
        // -------------------------------------------------------------
        IProductRegistry(address(productRegistry)).transferFrom(
            msg.sender, // 制造商
            retailerAddress, // 零售商
            tokenId
        );

        // 4. 记录事件：记录制造商 -> 零售商的初始分发历史。
        productRegistry.recordOwnershipTransfer(tokenId, msg.sender, retailerAddress, "INITIAL_DISTRIBUTION");
    }

    // listProductForSale: 零售商将产品上架以供销售。 (新增功能)
    function listProductForSale(uint256 productId, uint256 price) external {
        require(address(productRegistry) != address(0), "MP: Registry not set.");
        // 权限和所有权检查
        require(accessControl.isRetailer(msg.sender), "MP: Only Retailer can list.");
        require(productRegistry.ownerOf(productId) == msg.sender, "MP: Caller is not the product owner.");
        
        // 更新市场信息，设置价格和上架状态 (isListed = true)。
        productRegistry.updateMarketInfo(productId, price, true); 
        
        // 核心修复：发出 ProductListed 事件，使测试通过
        emit ProductListed(productId, price, msg.sender);
    }

    // retailSaleToCustomer：零售商将产品销售给最终消费者的流程。
    function retailSaleToCustomer(
        uint256 productId,             // 要销售的产品 NFT ID。
        address customerAddress        // 最终客户的地址。
    ) external {
        // 权限和所有权检查：确保只有拥有产品的零售商才能执行此操作。
        require(accessControl.isRetailer(msg.sender), "MP: Only Retailer can sell.");
        require(address(productRegistry) != address(0), "MP: Registry not set."); 
        
        address currentOwner = productRegistry.ownerOf(productId);
        require(currentOwner == msg.sender, "MP: Caller is not the product owner.");
        
        // 1. 下架：更新市场信息，标记产品已售出。
        productRegistry.updateMarketInfo(productId, 0, false);
        
        // 2. 所有权转移：零售商 -> 客户，使用标准 transferFrom (Retailer is a role).
        // 注意：这里的调用者是 Marketplace 合约，它在 ProductRegistry 中应具有操作权限。
        IProductRegistry(address(productRegistry)).transferFrom(currentOwner, customerAddress, productId);
        
        // 3. 记录事件：记录零售销售历史。
        productRegistry.recordOwnershipTransfer(productId, currentOwner, customerAddress, "RETAIL_SALE");
    }

    // customerResale：最终客户通过 Marketplace 将产品转售给其他客户的流程。
    function customerResale(
        uint256 productId, 
        address newCustomerAddress, 
        uint256 newPrice, 
        bool isListed // <--- 确保这里没有逗号
    ) external {
        require(address(productRegistry) != address(0), "MP: Registry not set."); 

        address currentOwner = productRegistry.ownerOf(productId);
        // 权限检查：确保只有当前所有者才能发起转售。
        require(currentOwner == msg.sender, "MP: Only current owner can initiate resale.");
        
        // 1. 更新市场信息：设置新的价格和上架状态。
        productRegistry.updateMarketInfo(productId, newPrice, isListed);

        // 2. 所有权转移：客户 -> 新客户，使用 restrictedTransferFrom (此转账需 Marketplace 授权)。
        // Marketplace 调用 restrictedTransferFrom，ProductRegistry 检查 Marketplace 是否被授权。
        IProductRegistry(address(productRegistry)).restrictedTransferFrom(
            currentOwner, 
            newCustomerAddress, 
            productId
        );
        
        // 3. 记录事件：记录客户间的二手交易历史。
        productRegistry.recordOwnershipTransfer(productId, currentOwner, newCustomerAddress, "CUSTOMER_RESALE");
    }
}