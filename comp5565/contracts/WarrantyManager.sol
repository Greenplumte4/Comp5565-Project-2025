// File: WarrantyManager.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./I_Interfaces.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; 

contract WarrantyManager is IWarrantyManager, Ownable { 

    address public productRegistryAddress;
    address public rolesContractAddress;
    address public marketplaceContract;

    enum ClaimStatus { None, Active, Pending, Expired, Fulfilled }

    struct Warranty {
        uint256 startDate;
        uint256 durationDays; 
        uint8 maxClaims;
        uint8 claimedCount;
        ClaimStatus status;
        string serviceLog;
    }
    
    event ServiceRequested(uint256 indexed tokenId, address indexed customer, string reason);
    event ClaimResolved(uint256 indexed tokenId, address indexed serviceCenter, uint8 newClaimsCount);
    event ClaimRejected(uint256 indexed tokenId, address indexed serviceCenter, string reason);

    mapping(uint256 => Warranty) public warranties;

    constructor(address _rolesAddr) Ownable(msg.sender) { 
        require(_rolesAddr != address(0), "Invalid address");
        rolesContractAddress = _rolesAddr;
    }

    function setProductRegistryAddress(address _registryAddr) public override onlyOwner { 
        require(productRegistryAddress == address(0), "WM: Registry already set.");
        require(_registryAddr != address(0), "WM: Invalid address.");
        productRegistryAddress = _registryAddr; 
    }

    function setMarketplaceAddress(address _mpAddr) public override onlyOwner { 
        require(marketplaceContract == address(0), "WM: Marketplace already set.");
        require(_mpAddr != address(0), "WM: Invalid address.");
        marketplaceContract = _mpAddr;
    }

    modifier onlyServiceCenter() {
        require(IRolesContract(rolesContractAddress).isServiceCenter(msg.sender), "Caller is not a Service Center");
        _;
    }

    function issueWarranty(uint256 tokenId, uint256 durationDays, uint8 maxClaims) public override {
        require(
            IRolesContract(rolesContractAddress).isManufacturer(msg.sender) || msg.sender == marketplaceContract,
            "WM: Not Manufacturer or Marketplace"
        );
        // 只有第一次发行时有效
        require(warranties[tokenId].status == ClaimStatus.None, "Warranty already issued.");

        warranties[tokenId] = Warranty({
            startDate: block.timestamp,
            durationDays: durationDays, 
            maxClaims: maxClaims,
            claimedCount: 0,
            status: ClaimStatus.Active,
            serviceLog: ""
        });
    }

    function requestService(uint256 tokenId) public override {
        _requestServiceInternal(tokenId, "");
    }

    function requestService(uint256 tokenId, string memory reason) public {
        _requestServiceInternal(tokenId, reason);
    }

    function _requestServiceInternal(uint256 tokenId, string memory reason) internal {
        Warranty storage warranty = warranties[tokenId];

        require(warranty.status != ClaimStatus.None, "Warranty not issued.");
        require(productRegistryAddress != address(0), "WM: Registry address not set.");

        address currentOwner = IProductRegistry(productRegistryAddress).ownerOf(tokenId);
        require(msg.sender == currentOwner, "Caller is not the product owner.");

        if (block.timestamp >= warranty.startDate + (warranty.durationDays * 1 days)) {
            warranty.status = ClaimStatus.Expired;
            revert("Warranty has expired.");
        }
        if (warranty.status == ClaimStatus.Fulfilled) {
            revert("Maximum claims reached.");
        }
        require(warranty.claimedCount < warranty.maxClaims, "Maximum claims reached.");
        require(warranty.status == ClaimStatus.Active, "Warranty is not active.");

        warranty.status = ClaimStatus.Pending;
        emit ServiceRequested(tokenId, msg.sender, reason);
    }

    function approveClaim(uint256 tokenId, string memory log) public override onlyServiceCenter {
        Warranty storage warranty = warranties[tokenId];
        require(warranty.status == ClaimStatus.Pending, "Claim not in pending state.");

        warranty.claimedCount++;
        warranty.serviceLog = log;

        if (warranty.claimedCount >= warranty.maxClaims) {
            warranty.status = ClaimStatus.Fulfilled;
        } else {
            warranty.status = ClaimStatus.Active;
        }
        emit ClaimResolved(tokenId, msg.sender, warranty.claimedCount);
    }

    function rejectClaim(uint256 tokenId, string memory reason) public override onlyServiceCenter {
        Warranty storage warranty = warranties[tokenId];
        require(warranty.status == ClaimStatus.Pending, "Claim not in pending state.");

        warranty.status = ClaimStatus.Active;
        warranty.serviceLog = string.concat("Rejected: ", reason);
        emit ClaimRejected(tokenId, msg.sender, reason);
    }

    function isWarrantyValid(uint256 productId) public view override returns (bool) {
        Warranty memory warranty = warranties[productId];
        if (warranty.status == ClaimStatus.Active || warranty.status == ClaimStatus.Pending) {
            if (block.timestamp >= warranty.startDate + (warranty.durationDays * 1 days)) {
                return false;
            }
            return true;
        }
        return false;
    }

    function getWarrantyStatus(uint256 tokenId) external view override returns (uint256, uint256, uint8, uint8, uint8, string memory) {
        Warranty memory w = warranties[tokenId];
        ClaimStatus actualStatus = w.status;
        
        if ((actualStatus == ClaimStatus.Active || actualStatus == ClaimStatus.Pending) && 
            (block.timestamp >= w.startDate + (w.durationDays * 1 days))
        ) {
            actualStatus = ClaimStatus.Expired;
        }
        return (w.startDate, w.durationDays, w.maxClaims, w.claimedCount, uint8(actualStatus), w.serviceLog);
    }
}