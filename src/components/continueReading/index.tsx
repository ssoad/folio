import { connect } from "react-redux";
import { withTranslation } from "react-i18next";
import ContinueReading from "./component";
import { handleReadingBook } from "../../store/actions";

const actionCreator = { handleReadingBook };
export default connect(
  null,
  actionCreator
)(withTranslation()(ContinueReading as any) as any);
