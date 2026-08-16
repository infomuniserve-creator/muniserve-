-- Real gap found while discussing what happens when a returning owner's
-- registered mobile number stops working (lost phone, changed SIM) --
-- there was no way back in for them, self-service OR staff-assisted.
--
-- Self-service can't safely re-link an ALREADY-claimed business to a new
-- phone number: License Number alone is only a safe-enough bar for the
-- very FIRST claim (nobody owns it yet). Letting the same lookup re-link
-- an already-claimed business would let anyone who's ever seen that
-- number (printed on a permit or receipt) hijack someone else's account.
--
-- Staff-assisted didn't exist either -- `owners` never had an UPDATE
-- policy at all (only SELECT and BPLO-only INSERT, migration 0002), so
-- even BPLO verifying the owner's identity in person at the counter had
-- no way to actually change the phone number on file.
--
-- Scoped the same way the existing SELECT policy already is (owners
-- linked to a business at BPLO's own LGU) -- BPLO can update an owner's
-- contact details, not create a phantom link to some other LGU's owner.
create policy "bplo can update owners linked to a business at their own lgu"
on owners for update
using (
  (select role from current_staff()) = 'bplo'
  and exists (
    select 1 from businesses b
    where b.owner_id = owners.id
      and b.lgu_id = (select lgu_id from current_staff())
  )
)
with check (
  (select role from current_staff()) = 'bplo'
  and exists (
    select 1 from businesses b
    where b.owner_id = owners.id
      and b.lgu_id = (select lgu_id from current_staff())
  )
);
