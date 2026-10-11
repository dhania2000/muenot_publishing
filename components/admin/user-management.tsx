import { UserCheck } from "lucide-react"
import {
  approveUserAction,
  disableUserAction,
  enableUserAction,
  rejectUserAction,
} from "@/app/(workspace)/admin/users/actions"
import { ActionButton } from "@/components/admin/action-button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export type ManagedUser = {
  id: number
  name: string
  email: string
  role: "admin" | "employee"
  status: "pending" | "active" | "disabled"
  createdAt: string
}

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" })

export function UserManagement({ users, currentUserId }: { users: ManagedUser[]; currentUserId: number }) {
  const pending = users.filter((u) => u.status === "pending")
  const others = users.filter((u) => u.status !== "pending")

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Pending approval
            {pending.length ? <Badge>{pending.length}</Badge> : null}
          </CardTitle>
          <CardDescription>These people signed up and can&apos;t sign in until you approve them.</CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {pending.map((user) => (
                <li key={user.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {user.email}
                      <span aria-hidden="true">{" · "}</span>
                      <span className="sr-only">, </span>
                      {`Signed up ${dateFormat.format(new Date(user.createdAt))}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <ActionButton
                      action={rejectUserAction.bind(null, user.id)}
                      variant="outline"
                      label="Reject"
                      pendingLabel="Rejecting"
                      aria-label={`Reject ${user.name}`}
                      confirm={`Reject and delete the account request from ${user.email}?`}
                    />
                    <ActionButton
                      action={approveUserAction.bind(null, user.id)}
                      label="Approve"
                      pendingLabel="Approving"
                      aria-label={`Approve ${user.name}`}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty className="border-0 p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UserCheck aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No pending requests</EmptyTitle>
                <EmptyDescription>New sign-ups will appear here for approval.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All users</CardTitle>
          <CardDescription>Disabling an account signs that person out right away.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {others.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="max-w-56">
                    <p className="truncate font-medium">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </TableCell>
                  <TableCell className="hidden capitalize sm:table-cell">{user.role}</TableCell>
                  <TableCell>
                    <Badge variant={user.status === "active" ? "secondary" : "outline"} className="capitalize">
                      {user.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {user.id === currentUserId ? (
                      <span className="text-xs text-muted-foreground">You</span>
                    ) : user.status === "active" ? (
                      <ActionButton
                        action={disableUserAction.bind(null, user.id)}
                        variant="ghost"
                        label="Disable"
                        pendingLabel="Disabling"
                        aria-label={`Disable ${user.name}`}
                        confirm={`Disable ${user.email}? They will be signed out immediately.`}
                      />
                    ) : (
                      <ActionButton
                        action={enableUserAction.bind(null, user.id)}
                        variant="ghost"
                        label="Enable"
                        pendingLabel="Enabling"
                        aria-label={`Enable ${user.name}`}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
