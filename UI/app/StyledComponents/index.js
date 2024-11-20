import { styled } from "@mui/material/styles";
import { Box, TableRow, TableCell } from "@mui/material";

export const ChapterCircle = styled(Box)(({ theme, status, onClick }) => ({
  width: 32,
  height: 32,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "0.875rem",
  fontWeight: 500,
  margin: "4px",
  transition: "all 0.2s ease-in-out",
  cursor: "pointer",
  "&:hover": {
    transform: "scale(1.05)",
  },
  ...(status === "Transcribed" && {
    backgroundColor: "#e8f5e9",
    border: "2px solid black",
    color: "#2e7d32",
  }),
  ...(status === "Disapproved" && {
    backgroundColor: "#e8f5e9",
    border: "2px solid black",
    color: "#2e7d32",
  }),
  ...(status === "inProgress" && {
    backgroundColor: "#fff3e0",
    color: "#ef6c00",
  }),
  ...(status === "pending" && {
    color: theme.palette.text.secondary,
    backgroundColor: theme.palette.grey[100],
  }),
  ...(status === "Approved" && {
    backgroundColor: "#EFF8FC",
    color: "#58ADCE",
  }),
  ...(status === "Failed" && {
    backgroundColor: "#FAA49D",
    color: "#F44336",
  }),
  onClick: onClick,
}));

export const StyledTableRow = styled(TableRow)(({ theme }) => ({
  "&:hover": {
    backgroundColor: theme.palette.grey[50],
  },
  "& td": {
    borderBottom: `1px solid ${theme.palette.grey[200]}`,
  },
}));

export const StyledTableCell = styled(TableCell)(({ theme }) => ({
  padding: theme.spacing(2),
}));

export const styles = {
  cardRoot: {
    width: "90%",
    maxWidth: "1200px",
    margin: "auto",
    p: 4,
    boxShadow: (theme) => theme.shadows[3],
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    mb: 4,
    px: 2,
  },
  TitleContainer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 2
  },
  headerTitle: {
    color: "#9c27b0",
    fontWeight: 600,
  },
  languageSelect: {
    "& .MuiSelect-select": {
      py: 1,
    },
  },
  chaptersContainer: {
    display: "flex",
    flexWrap: "wrap",
    gap: 0.5,
  },
  downloadButton: {
    backgroundColor: "#f3e5f5",
    color: "#9c27b0",
    py: 1.2,
    fontWeight: 500,
    "&:hover": {
      backgroundColor: "#e1bee7",
    },
  },
  iconButton: {
    "&:hover": {
      backgroundColor: (theme) => theme.palette.grey[100],
    },
  },
  tableContainer: {
    mb: 3,
  },
};