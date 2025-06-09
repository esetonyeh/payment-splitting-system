;; Band Payment Splitting Smart Contract
;; This contract allows bands to register collaborations and automatically split payments

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-BAND-NOT-FOUND (err u101))
(define-constant ERR-MEMBER-NOT-FOUND (err u102))
(define-constant ERR-INVALID-PERCENTAGE (err u103))
(define-constant ERR-INSUFFICIENT-BALANCE (err u104))
(define-constant ERR-ALREADY-EXISTS (err u105))
(define-constant ERR-INVALID-AMOUNT (err u106))

;; Data structures
(define-map bands
  { band-id: uint }
  {
    name: (string-ascii 50),
    owner: principal,
    total-members: uint,
    active: bool
  }
)

(define-map band-members
  { band-id: uint, member: principal }
  {
    name: (string-ascii 30),
    percentage: uint,
    total-earned: uint,
    joined-at: uint
  }
)

(define-map band-balances
  { band-id: uint }
  { balance: uint }
)

;; Global variables
(define-data-var next-band-id uint u1)
(define-data-var contract-owner principal tx-sender)
(define-data-var member-counter uint u0)

;; Private functions
(define-private (calculate-member-share (balance uint) (percentage uint))
  (/ (* balance percentage) u100)
)

;; Public functions

;; Create a new band
(define-public (create-band (name (string-ascii 50)))
  (let ((band-id (var-get next-band-id)))
    (asserts! (is-none (map-get? bands { band-id: band-id })) ERR-ALREADY-EXISTS)
    (map-set bands
      { band-id: band-id }
      {
        name: name,
        owner: tx-sender,
        total-members: u0,
        active: true
      }
    )
    (map-set band-balances { band-id: band-id } { balance: u0 })
    (var-set next-band-id (+ band-id u1))
    (ok band-id)
  )
)
;; Add a member to a band
(define-public (add-member (band-id uint) (member principal) (member-name (string-ascii 30)) (percentage uint))
  (let ((band-info (unwrap! (map-get? bands { band-id: band-id }) ERR-BAND-NOT-FOUND))
        (current-counter (var-get member-counter)))
    (asserts! (is-eq (get owner band-info) tx-sender) ERR-NOT-AUTHORIZED)
    (asserts! (and (> percentage u0) (<= percentage u100)) ERR-INVALID-PERCENTAGE)
    (asserts! (is-none (map-get? band-members { band-id: band-id, member: member })) ERR-ALREADY-EXISTS)
    
    (map-set band-members
      { band-id: band-id, member: member }
      {
        name: member-name,
        percentage: percentage,
        total-earned: u0,
        joined-at: current-counter
      }
    )
    
    (map-set bands
      { band-id: band-id }
      (merge band-info { total-members: (+ (get total-members band-info) u1) })
    )
    
    ;; Increment member counter
    (var-set member-counter (+ current-counter u1))
    
    (ok true)
  )
)
;; Update member percentage (only band owner)
(define-public (update-member-percentage (band-id uint) (member principal) (new-percentage uint))
  (let ((band-info (unwrap! (map-get? bands { band-id: band-id }) ERR-BAND-NOT-FOUND))
        (member-info (unwrap! (map-get? band-members { band-id: band-id, member: member }) ERR-MEMBER-NOT-FOUND)))
    (asserts! (is-eq (get owner band-info) tx-sender) ERR-NOT-AUTHORIZED)
    (asserts! (and (> new-percentage u0) (<= new-percentage u100)) ERR-INVALID-PERCENTAGE)
    
    (map-set band-members
      { band-id: band-id, member: member }
      (merge member-info { percentage: new-percentage })
    )
    
    (ok true)
  )
)
;; Deposit payment to band
(define-public (deposit-payment (band-id uint) (amount uint))
  (let ((band-info (unwrap! (map-get? bands { band-id: band-id }) ERR-BAND-NOT-FOUND))
        (current-balance (default-to { balance: u0 } (map-get? band-balances { band-id: band-id }))))
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (get active band-info) ERR-NOT-AUTHORIZED)
    
    ;; Transfer STX to contract
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    
    ;; Update band balance
    (map-set band-balances
      { band-id: band-id }
      { balance: (+ (get balance current-balance) amount) }
    )
    
    (ok true)
  )
)
;; Emergency withdraw all funds (band owner only)
(define-public (emergency-withdraw (band-id uint))
  (let ((band-info (unwrap! (map-get? bands { band-id: band-id }) ERR-BAND-NOT-FOUND))
        (band-balance (unwrap! (map-get? band-balances { band-id: band-id }) ERR-BAND-NOT-FOUND)))
    (asserts! (is-eq (get owner band-info) tx-sender) ERR-NOT-AUTHORIZED)
    (asserts! (> (get balance band-balance) u0) ERR-INSUFFICIENT-BALANCE)
    
    (let ((total-balance (get balance band-balance)))
      ;; Transfer all funds to band owner
      (try! (as-contract (stx-transfer? total-balance tx-sender (get owner band-info))))
      
      ;; Reset band balance
      (map-set band-balances { band-id: band-id } { balance: u0 })
      
      (ok total-balance)
    )
  )
)

;; Withdraw individual member earnings
(define-public (withdraw-earnings (band-id uint))
  (let ((member-info (unwrap! (map-get? band-members { band-id: band-id, member: tx-sender }) ERR-MEMBER-NOT-FOUND))
        (band-balance (unwrap! (map-get? band-balances { band-id: band-id }) ERR-BAND-NOT-FOUND)))
    
    (let ((member-share (calculate-member-share (get balance band-balance) (get percentage member-info))))
      (asserts! (> member-share u0) ERR-INSUFFICIENT-BALANCE)
      
      ;; Transfer earnings to member
      (try! (as-contract (stx-transfer? member-share tx-sender tx-sender)))
      
      ;; Update member's total earned
      (map-set band-members
        { band-id: band-id, member: tx-sender }
        (merge member-info { total-earned: (+ (get total-earned member-info) member-share) })
      )
      
      ;; Update band balance
      (map-set band-balances
        { band-id: band-id }
        { balance: (- (get balance band-balance) member-share) }
      )
      
      (ok member-share)
    )
  )
)

;; Read-only functions

;; Get band information
(define-read-only (get-band-info (band-id uint))
  (map-get? bands { band-id: band-id })
)

;; Get member information
(define-read-only (get-member-info (band-id uint) (member principal))
  (map-get? band-members { band-id: band-id, member: member })
)

;; Get band balance
(define-read-only (get-band-balance (band-id uint))
  (map-get? band-balances { band-id: band-id })
)

;; Calculate member's current earnings
(define-read-only (calculate-member-earnings (band-id uint) (member principal))
  (match (map-get? band-members { band-id: band-id, member: member })
    member-info 
      (match (map-get? band-balances { band-id: band-id })
        band-balance
          (some (calculate-member-share (get balance band-balance) (get percentage member-info)))
        none
      )
    none
  )
)

;; Get member join order
(define-read-only (get-member-join-order)
  (var-get member-counter)
)

;; Get total number of bands
(define-read-only (get-total-bands)
  (- (var-get next-band-id) u1)
)

;; Check if member exists in band
(define-read-only (is-band-member (band-id uint) (member principal))
  (is-some (map-get? band-members { band-id: band-id, member: member }))
)