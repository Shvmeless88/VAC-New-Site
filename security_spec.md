# Security Specification

## Data Invariants
- Leads must have a firstName, lastName, email, phone, and type.
- Inventory items are publicly readable but only writable by admins.
- Leads can be created by anyone (public submission) but only read/updated by admins.
- Users (admins) can only read/write their own profile, unless they have super_admin role.

## Dirty Dozen Payloads
1. Lead with missing required fields.
2. Lead with invalid email format.
3. Lead update by unauthorized user.
4. Inventory write by unauthorized user.
5. User profile update by another user.
6. Admin settings update by non-admin.
7. Lead with excessive string size (DoS).
8. Lead update changing immutable fields (e.g., createdAt).
9. Lead creation with spoofed ownerId.
10. Inventory deletion by non-admin.
11. Reading leads without being logged in as admin.
12. Bulk reading leads by non-admin.
