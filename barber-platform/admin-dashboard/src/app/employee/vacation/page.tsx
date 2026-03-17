"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EmployeeVacationRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/employee/vacations");
  }, [router]);
  return null;
}
